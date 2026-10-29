#!/bin/bash
# Deploy (or update) LetsGo Together on an Unraid box. Run this in the Unraid terminal:
#
#   curl -fsSL https://raw.githubusercontent.com/Leshko/letsgo-trip-planner/main/deploy/unraid-deploy.sh | bash
#
# Two containers on Docker's standard bridge (nothing that a Docker restart can delete):
#   letsgo-db  PostgreSQL 16, data in /mnt/user/appdata/letsgo/postgres, reachable only
#              from this box's Docker containers (docker0 gateway, port 5433)
#   letsgo     the app on port 3001, photos and push keys in /mnt/user/appdata/letsgo
#
# Settings (AI key, admin key, sign-in, email) live on the containers, so you can
# change them in the Unraid Docker tab (click the icon -> Edit). This script keeps
# whatever is set there. An old letsgo.env file is moved into the container once.
#
# Safe to run any time: it snapshots the database first, and if the new version
# doesn't come up healthy it puts the previous container back exactly as it was.
set -euo pipefail

IMAGE="${IMAGE:-ghcr.io/leshko/letsgo-trip-planner:latest}"
DB_IMAGE="${DB_IMAGE:-postgres:16-alpine}"
PORT="${PORT:-3001}"
DB_PORT="${DB_PORT:-5433}"
DATA="${DATA:-/mnt/user/appdata/letsgo}"
DB_DIR="${DATA}/postgres"
BACKUPS="${DATA}/backups"
DB_SECRETS="${DATA}/db.env"
ENV_FILE="${ENV_FILE:-${DATA}/letsgo.env}"
TEMPLATES="${TEMPLATES:-/boot/config/plugins/dockerMan/templates-user}"
ICON="https://raw.githubusercontent.com/Leshko/letsgo-trip-planner/main/web/public/icons/icon-192.png"
PROJECT="https://github.com/Leshko/letsgo-trip-planner"
STAMP="$(date +%Y%m%d-%H%M%S)"

# Settings people may set. Anything else on the container is managed by this script.
KEYS=(ANTHROPIC_API_KEY ADMIN_KEY PUBLIC_URL
      GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET MICROSOFT_CLIENT_ID MICROSOFT_CLIENT_SECRET MICROSOFT_TENANT
      SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS MAIL_FROM
      AI_MODEL AI_ENRICH AI_DAILY_CAP VAPID_SUBJECT)

say() { echo "==> $*"; }
is_key() { local k; for k in "${KEYS[@]}"; do [ "$k" = "$1" ] && return 0; done; return 1; }

mkdir -p "$DATA" "$BACKUPS" "$DB_DIR"
# The app runs as the unprivileged "node" user (uid 1000). Postgres manages its own folder.
chown 1000:1000 "$DATA" "$BACKUPS" 2>/dev/null || true
[ -d "$DATA/photos" ] && chown -R 1000:1000 "$DATA/photos" 2>/dev/null || true

if [ "${PULL:-1}" = "1" ]; then
  say "Pulling $IMAGE and $DB_IMAGE"
  docker pull "$IMAGE"
  docker pull "$DB_IMAGE"
fi

# ---- settings: what's on the container (Docker tab) wins; env file and shell only fill gaps ----
declare -A SET=()
IMPORTED_FILE=""
if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*# || "$line" != *=* ]] && continue
    k="${line%%=*}"; k="${k//[[:space:]]/}"; v="${line#*=}"
    is_key "$k" && SET[$k]="$v"
  done < "$ENV_FILE"
  IMPORTED_FILE="$ENV_FILE"
fi
if docker inspect letsgo >/dev/null 2>&1; then
  while IFS= read -r line; do
    k="${line%%=*}"; v="${line#*=}"
    is_key "$k" && SET[$k]="$v"
  done < <(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' letsgo)
fi
# The Docker tab is the source of truth: a value given on the command line only
# fills in a setting the container doesn't have yet.
for k in "${KEYS[@]}"; do
  if [ -n "${!k:-}" ] && [ -z "${SET[$k]:-}" ]; then SET[$k]="${!k}"; fi
done

# ---- database password: generated once, kept next to the data, never printed ----
if [ ! -f "$DB_SECRETS" ]; then
  PW="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
  printf 'POSTGRES_PASSWORD=%s\n' "$PW" > "$DB_SECRETS"
fi
chmod 600 "$DB_SECRETS"
PW="$(grep '^POSTGRES_PASSWORD=' "$DB_SECRETS" | cut -d= -f2-)"

# The docker0 gateway: every container on the standard bridge can reach it, the LAN can't.
GW="$(docker network inspect bridge --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null | head -1)"
GW="${GW:-172.17.0.1}"
DATABASE_URL="postgres://letsgo:${PW}@${GW}:${DB_PORT}/letsgo"

# ---- database container ----
db_ready() {
  for i in $(seq 1 60); do
    docker exec letsgo-db pg_isready -U letsgo -d letsgo >/dev/null 2>&1 && return 0
    sleep 2
  done
  echo "PostgreSQL did not start. Logs:"; docker logs --tail 40 letsgo-db; return 1
}

run_db() {
  docker run -d \
    --name letsgo-db \
    --restart unless-stopped \
    -p "${GW}:${DB_PORT}:5432" \
    -v "${DB_DIR}:/var/lib/postgresql/data" \
    -e POSTGRES_USER=letsgo \
    -e POSTGRES_DB=letsgo \
    -e POSTGRES_PASSWORD="$PW" \
    -l net.unraid.docker.managed=dockerman \
    -l net.unraid.docker.icon="https://raw.githubusercontent.com/docker-library/docs/master/postgres/logo.png" \
    "$DB_IMAGE" >/dev/null
}

snapshot() {
  if docker exec letsgo-db psql -U letsgo -d letsgo -tAc "select 1 from information_schema.tables where table_name='trip'" 2>/dev/null | grep -q 1; then
    say "Backing up PostgreSQL to $BACKUPS/letsgo-$STAMP.sql.gz"
    docker exec letsgo-db pg_dump -U letsgo -d letsgo | gzip > "$BACKUPS/letsgo-$STAMP.sql.gz"
    ls -1t "$BACKUPS"/letsgo-*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm -f
  fi
}

DB_RECREATED=0
if docker inspect letsgo-db >/dev/null 2>&1; then
  docker start letsgo-db >/dev/null 2>&1 || true
  db_ready
  snapshot
  # Earlier releases joined the two containers with a custom network, which Unraid can
  # delete when Docker restarts. Move the database to the gateway port (same data).
  if ! docker inspect --format '{{json .HostConfig.PortBindings}}' letsgo-db | grep -q "\"${DB_PORT}\""; then
    say "Moving PostgreSQL to a connection that survives Docker restarts"
    docker stop letsgo-db >/dev/null
    docker rename letsgo-db letsgo-db-previous
    run_db
    DB_RECREATED=1
    db_ready
  fi
else
  say "Starting PostgreSQL"
  run_db
  db_ready
fi

# ---- set the current app aside (stopped, untouched) so it can be put back ----
PREV=0
if docker inspect letsgo >/dev/null 2>&1; then
  docker rm -f letsgo-previous >/dev/null 2>&1 || true
  docker stop letsgo >/dev/null 2>&1 || true
  docker rename letsgo letsgo-previous
  docker update --restart no letsgo-previous >/dev/null 2>&1 || true
  PREV=1
fi

if [ -f "$DATA/letsgo.sqlite" ] && [ ! -f "$BACKUPS/letsgo-before-postgres.sqlite" ]; then
  say "Backing up the current database to $BACKUPS/letsgo-before-postgres.sqlite"
  cp -p "$DATA/letsgo.sqlite" "$BACKUPS/letsgo-before-postgres.sqlite"
  [ -f "$DATA/vapid.json" ] && cp -p "$DATA/vapid.json" "$BACKUPS/vapid-before-postgres.json"
fi

ENV_ARGS=()
for k in "${KEYS[@]}"; do
  if [ -n "${SET[$k]:-}" ]; then ENV_ARGS+=(-e "$k=${SET[$k]}"); fi
done

say "Starting LetsGo Together"
docker run -d \
  --name letsgo \
  --restart unless-stopped \
  -p "${PORT}:3001" \
  -v "${DATA}:/data" \
  -e PORT=3001 \
  -e DATA_DIR=/data \
  -e DB_PATH=/data/letsgo.sqlite \
  -e DATABASE_URL="$DATABASE_URL" \
  ${ENV_ARGS[@]+"${ENV_ARGS[@]}"} \
  -l net.unraid.docker.managed=dockerman \
  -l net.unraid.docker.webui="http://[IP]:[PORT:${PORT}]/" \
  -l net.unraid.docker.icon="$ICON" \
  "$IMAGE" >/dev/null

healthy() {
  for i in $(seq 1 60); do
    if docker exec letsgo node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      return 0
    fi
    # Crashing on startup: Docker keeps restarting it; don't wait out the full minute.
    if [ "$(docker inspect --format '{{.RestartCount}}' letsgo 2>/dev/null || echo 0)" -ge 2 ]; then
      return 1
    fi
    if [ "$(docker inspect --format '{{.State.Running}}' letsgo 2>/dev/null)" != "true" ] && [ "$i" -gt 5 ]; then
      return 1
    fi
    sleep 2
  done
  return 1
}

if ! healthy; then
  echo
  echo "!! The new version did not start. Its last log lines:"
  docker logs --tail 40 letsgo 2>&1 | sed 's/^/   /'
  docker rm -f letsgo >/dev/null 2>&1 || true
  if [ "$DB_RECREATED" = "1" ]; then
    docker rm -f letsgo-db >/dev/null 2>&1 || true
    docker rename letsgo-db-previous letsgo-db
    docker start letsgo-db >/dev/null
  fi
  if [ "$PREV" = "1" ]; then
    echo "!! Putting the previous version back. Your data was not changed."
    docker rename letsgo-previous letsgo
    docker update --restart unless-stopped letsgo >/dev/null 2>&1 || true
    docker start letsgo >/dev/null
  fi
  exit 1
fi

docker logs letsgo 2>&1 | grep -E "Imported the old SQLite database|Skipped rows" | sed 's/^/   /' || true

# ---- success: clean up what was set aside ----
docker rm -f letsgo-previous >/dev/null 2>&1 || true
if [ "$DB_RECREATED" = "1" ]; then
  docker rm -f letsgo-db-previous >/dev/null 2>&1 || true
fi
docker network rm letsgo-net >/dev/null 2>&1 || true
if [ -n "$IMPORTED_FILE" ]; then
  mv "$IMPORTED_FILE" "${IMPORTED_FILE}.imported-${STAMP}"
  chmod 600 "${IMPORTED_FILE}.imported-${STAMP}" 2>/dev/null || true
  say "Moved the settings from $(basename "$IMPORTED_FILE") onto the container. Change them in the Docker tab from now on."
fi

# ---- Unraid Docker tab: templates so the containers show Edit with every setting ----
xml() { local s="$1"; s="${s//&/&amp;}"; s="${s//</&lt;}"; s="${s//>/&gt;}"; s="${s//\"/&quot;}"; printf '%s' "$s"; }
var() { # name, key, description, display(always|advanced), mask(true|false)
  printf '  <Config Name="%s" Target="%s" Default="" Mode="" Description="%s" Type="Variable" Display="%s" Required="false" Mask="%s">%s</Config>\n' \
    "$1" "$2" "$(xml "$3")" "$4" "$5" "$(xml "${SET[$2]:-}")"
}
if [ -d "$TEMPLATES" ]; then
  {
    echo '<?xml version="1.0"?>'
    echo '<Container version="2">'
    echo '  <Name>letsgo</Name>'
    echo "  <Repository>$(xml "$IMAGE")</Repository>"
    echo "  <Registry>${PROJECT}/pkgs/container/letsgo-trip-planner</Registry>"
    echo '  <Network>bridge</Network>'
    echo '  <MyIP/>'
    echo '  <Shell>sh</Shell>'
    echo '  <Privileged>false</Privileged>'
    echo "  <Support>${PROJECT}</Support>"
    echo "  <Project>${PROJECT}</Project>"
    echo '  <Overview>LetsGo Together: plan a family trip together. Settings below; updates through the deploy line keep backups and roll back automatically.</Overview>'
    echo '  <Category>Productivity:</Category>'
    echo "  <WebUI>http://[IP]:[PORT:${PORT}]/</WebUI>"
    echo "  <Icon>${ICON}</Icon>"
    echo '  <ExtraParams>--restart unless-stopped</ExtraParams>'
    echo '  <PostArgs/>'
    echo "  <Config Name=\"Web port\" Target=\"3001\" Default=\"${PORT}\" Mode=\"tcp\" Description=\"Port the app is served on.\" Type=\"Port\" Display=\"always\" Required=\"true\" Mask=\"false\">${PORT}</Config>"
    echo "  <Config Name=\"Data\" Target=\"/data\" Default=\"$(xml "$DATA")\" Mode=\"rw\" Description=\"Photos, push keys, backups.\" Type=\"Path\" Display=\"always\" Required=\"true\" Mask=\"false\">$(xml "$DATA")</Config>"
    var "Anthropic API key" ANTHROPIC_API_KEY "AI link summaries (from console.anthropic.com). Leave empty to turn them off." always true
    var "Admin key" ADMIN_KEY "Unlocks /admin. 16 characters or more." always true
    var "Public URL" PUBLIC_URL "Main web address, e.g. https://letsgotogether.app. Only set once that address opens the app." always false
    var "Google client ID" GOOGLE_CLIENT_ID "Google sign-in." always false
    var "Google client secret" GOOGLE_CLIENT_SECRET "Google sign-in." always true
    var "Microsoft client ID" MICROSOFT_CLIENT_ID "Microsoft sign-in." always false
    var "Microsoft client secret" MICROSOFT_CLIENT_SECRET "Microsoft sign-in." always true
    var "SMTP host" SMTP_HOST "Email for sign-in codes, e.g. smtp.resend.com" always false
    var "SMTP password" SMTP_PASS "Resend API key (re_...)." always true
    var "Mail from" MAIL_FROM "e.g. LetsGo Together &lt;trips@letsgotogether.app&gt;" always false
    var "SMTP port" SMTP_PORT "465 for Resend." advanced false
    var "SMTP user" SMTP_USER "resend for Resend." advanced false
    var "Microsoft tenant" MICROSOFT_TENANT "Leave empty (common)." advanced false
    var "AI model" AI_MODEL "Leave empty for the default." advanced false
    var "AI on/off" AI_ENRICH "0 turns AI summaries off even with a key." advanced false
    var "AI daily cap" AI_DAILY_CAP "Summaries per trip per day (150)." advanced false
    var "Push contact" VAPID_SUBJECT "mailto: address for push services." advanced false
    printf '  <Config Name="Database URL" Target="DATABASE_URL" Default="" Mode="" Description="Managed by the deploy script." Type="Variable" Display="advanced" Required="true" Mask="true">%s</Config>\n' "$(xml "$DATABASE_URL")"
    echo '  <Config Name="Data dir" Target="DATA_DIR" Default="/data" Mode="" Description="" Type="Variable" Display="advanced" Required="true" Mask="false">/data</Config>'
    echo '  <Config Name="Old database file" Target="DB_PATH" Default="/data/letsgo.sqlite" Mode="" Description="Imported once." Type="Variable" Display="advanced" Required="true" Mask="false">/data/letsgo.sqlite</Config>'
    echo '  <Config Name="Port inside the container" Target="PORT" Default="3001" Mode="" Description="" Type="Variable" Display="advanced" Required="true" Mask="false">3001</Config>'
    echo '</Container>'
  } > "$TEMPLATES/my-letsgo.xml"
  {
    echo '<?xml version="1.0"?>'
    echo '<Container version="2">'
    echo '  <Name>letsgo-db</Name>'
    echo "  <Repository>$(xml "$DB_IMAGE")</Repository>"
    echo '  <Registry>https://hub.docker.com/_/postgres</Registry>'
    echo '  <Network>bridge</Network>'
    echo '  <MyIP/>'
    echo '  <Shell>sh</Shell>'
    echo '  <Privileged>false</Privileged>'
    echo "  <Support>${PROJECT}</Support>"
    echo '  <Overview>Database for LetsGo Together. Only reachable from containers on this server. Managed by the LetsGo deploy line; no need to edit.</Overview>'
    echo '  <Category>Tools:</Category>'
    echo '  <WebUI/>'
    echo '  <Icon>https://raw.githubusercontent.com/docker-library/docs/master/postgres/logo.png</Icon>'
    echo "  <ExtraParams>--restart unless-stopped -p ${GW}:${DB_PORT}:5432</ExtraParams>"
    echo '  <PostArgs/>'
    echo "  <Config Name=\"Database files\" Target=\"/var/lib/postgresql/data\" Default=\"$(xml "$DB_DIR")\" Mode=\"rw\" Description=\"\" Type=\"Path\" Display=\"always\" Required=\"true\" Mask=\"false\">$(xml "$DB_DIR")</Config>"
    echo '  <Config Name="User" Target="POSTGRES_USER" Default="letsgo" Mode="" Description="" Type="Variable" Display="advanced" Required="true" Mask="false">letsgo</Config>'
    echo '  <Config Name="Database" Target="POSTGRES_DB" Default="letsgo" Mode="" Description="" Type="Variable" Display="advanced" Required="true" Mask="false">letsgo</Config>'
    printf '  <Config Name="Password" Target="POSTGRES_PASSWORD" Default="" Mode="" Description="Must match the app'"'"'s database URL." Type="Variable" Display="advanced" Required="true" Mask="true">%s</Config>\n' "$(xml "$PW")"
    echo '</Container>'
  } > "$TEMPLATES/my-letsgo-db.xml"
  chmod 600 "$TEMPLATES/my-letsgo.xml" "$TEMPLATES/my-letsgo-db.xml" 2>/dev/null || true
fi

if [ -n "${SET[ANTHROPIC_API_KEY]:-}" ]; then
  echo "AI link summaries: on"
else
  echo "AI link summaries: off (Docker tab -> letsgo -> Edit -> Anthropic API key)"
fi
if [ -n "${SET[ADMIN_KEY]:-}" ]; then echo "Admin screen: on (/admin)"; fi

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "LetsGo Together is running: http://${IP:-<unraid-ip>}:${PORT}"
echo "Backups: $BACKUPS"
