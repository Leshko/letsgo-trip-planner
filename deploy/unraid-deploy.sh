#!/bin/bash
# Deploy (or update) LetsGo Together on an Unraid box. Run this in the Unraid terminal:
#
#   curl -fsSL https://raw.githubusercontent.com/Leshko/letsgo-trip-planner/main/deploy/unraid-deploy.sh | bash
#
# Runs two containers on a private Docker network:
#   letsgo-db  PostgreSQL 16, data in /mnt/user/appdata/letsgo/postgres
#   letsgo     the app on port 3001, photos and settings in /mnt/user/appdata/letsgo
#
# Safe to run any time. Before anything changes it backs up the data, and if the
# new version doesn't come up healthy it puts the previous version back.
set -euo pipefail

IMAGE="${IMAGE:-ghcr.io/leshko/letsgo-trip-planner:latest}"
DB_IMAGE="${DB_IMAGE:-postgres:16-alpine}"
PORT="${PORT:-3001}"
DATA="${DATA:-/mnt/user/appdata/letsgo}"
NET="letsgo-net"
DB_DIR="${DATA}/postgres"
BACKUPS="${DATA}/backups"
DB_SECRETS="${DATA}/db.env"
ENV_FILE="${ENV_FILE:-${DATA}/letsgo.env}"
STAMP="$(date +%Y%m%d-%H%M%S)"

say() { echo "==> $*"; }

mkdir -p "$DATA" "$BACKUPS" "$DB_DIR"
# The app runs as the unprivileged "node" user (uid 1000). Postgres manages its own folder.
chown 1000:1000 "$DATA" "$BACKUPS" 2>/dev/null || true
[ -d "$DATA/photos" ] && chown -R 1000:1000 "$DATA/photos" 2>/dev/null || true

if [ "${PULL:-1}" = "1" ]; then
  say "Pulling $IMAGE and $DB_IMAGE"
  docker pull "$IMAGE"
  docker pull "$DB_IMAGE"
fi

# ---- database password: generated once, kept next to the data, never printed ----
if [ ! -f "$DB_SECRETS" ]; then
  PW="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
  printf 'POSTGRES_PASSWORD=%s\n' "$PW" > "$DB_SECRETS"
fi
chmod 600 "$DB_SECRETS"
PW="$(grep '^POSTGRES_PASSWORD=' "$DB_SECRETS" | cut -d= -f2-)"
DATABASE_URL="postgres://letsgo:${PW}@letsgo-db:5432/letsgo"

docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null

# ---- remember what is running now, so it can be put back ----
PREV_IMAGE="$(docker inspect --format '{{.Image}}' letsgo 2>/dev/null || true)"
PREV_MODE="none"
if [ -n "$PREV_IMAGE" ]; then
  if docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' letsgo | grep -q '^DATABASE_URL='; then
    PREV_MODE="postgres"
  else
    PREV_MODE="sqlite"
  fi
fi

# Optional settings (sign-in providers, email, AI) live in an env file next to the data,
# so secrets never pass through shell history. Shell variables also pass through.
EXTRA=()
if [ -f "$ENV_FILE" ]; then
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  EXTRA+=(--env-file "$ENV_FILE")
fi
for v in ANTHROPIC_API_KEY AI_MODEL AI_ENRICH AI_DAILY_CAP VAPID_SUBJECT PUBLIC_URL \
         GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET MICROSOFT_CLIENT_ID MICROSOFT_CLIENT_SECRET \
         SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS MAIL_FROM ADMIN_KEY; do
  if [ -n "${!v:-}" ]; then EXTRA+=(-e "$v=${!v}"); fi
done

# ---- stop the app so nothing writes while we back up ----
docker rm -f letsgo >/dev/null 2>&1 || true

if [ -f "$DATA/letsgo.sqlite" ] && [ ! -f "$BACKUPS/letsgo-before-postgres.sqlite" ]; then
  say "Backing up the current database to $BACKUPS/letsgo-before-postgres.sqlite"
  cp -p "$DATA/letsgo.sqlite" "$BACKUPS/letsgo-before-postgres.sqlite"
  [ -f "$DATA/vapid.json" ] && cp -p "$DATA/vapid.json" "$BACKUPS/vapid-before-postgres.json"
fi

# ---- database container (left running across app updates) ----
if ! docker inspect letsgo-db >/dev/null 2>&1; then
  say "Starting PostgreSQL"
  docker run -d \
    --name letsgo-db \
    --restart unless-stopped \
    --network "$NET" \
    -v "${DB_DIR}:/var/lib/postgresql/data" \
    -e POSTGRES_USER=letsgo \
    -e POSTGRES_DB=letsgo \
    --env-file "$DB_SECRETS" \
    "$DB_IMAGE" >/dev/null
else
  docker start letsgo-db >/dev/null 2>&1 || true
fi

say "Waiting for PostgreSQL"
for i in $(seq 1 60); do
  if docker exec letsgo-db pg_isready -U letsgo -d letsgo >/dev/null 2>&1; then break; fi
  if [ "$i" = 60 ]; then echo "PostgreSQL did not start. Logs:"; docker logs --tail 40 letsgo-db; exit 1; fi
  sleep 2
done

# Snapshot the database before the new version runs any migrations (keeps the last 10).
if docker exec letsgo-db psql -U letsgo -d letsgo -tAc "select 1 from information_schema.tables where table_name='trip'" 2>/dev/null | grep -q 1; then
  say "Backing up PostgreSQL to $BACKUPS/letsgo-$STAMP.sql.gz"
  docker exec letsgo-db pg_dump -U letsgo -d letsgo | gzip > "$BACKUPS/letsgo-$STAMP.sql.gz"
  ls -1t "$BACKUPS"/letsgo-*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm -f
fi

run_app() { # $1 = image, $2 = postgres|sqlite
  local db_args=(-e DATABASE_URL="$DATABASE_URL")
  [ "$2" = "sqlite" ] && db_args=()
  docker run -d \
    --name letsgo \
    --restart unless-stopped \
    --network "$NET" \
    -p "${PORT}:3001" \
    -v "${DATA}:/data" \
    -e PORT=3001 \
    -e DATA_DIR=/data \
    -e DB_PATH=/data/letsgo.sqlite \
    "${db_args[@]}" \
    ${EXTRA[@]+"${EXTRA[@]}"} \
    "$1" >/dev/null
}

healthy() {
  for i in $(seq 1 60); do
    if docker exec letsgo node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      return 0
    fi
    if [ "$(docker inspect --format '{{.State.Running}}' letsgo 2>/dev/null)" != "true" ] && [ "$i" -gt 5 ]; then
      return 1
    fi
    sleep 2
  done
  return 1
}

say "Starting LetsGo Together"
run_app "$IMAGE" postgres
if ! healthy; then
  echo
  echo "!! The new version did not start. Its last log lines:"
  docker logs --tail 40 letsgo 2>&1 | sed 's/^/   /'
  docker rm -f letsgo >/dev/null 2>&1 || true
  if [ -n "$PREV_IMAGE" ]; then
    echo "!! Putting the previous version back. Your data was not changed."
    run_app "$PREV_IMAGE" "$PREV_MODE"
    healthy || true
  fi
  exit 1
fi

docker logs letsgo 2>&1 | grep -E "Imported the old SQLite database|Skipped rows" | sed 's/^/   /' || true

if [ -n "${ANTHROPIC_API_KEY:-}" ] || { [ -f "$ENV_FILE" ] && grep -q '^ANTHROPIC_API_KEY=' "$ENV_FILE"; }; then
  echo "AI link summaries: on"
else
  echo "AI link summaries: off (add ANTHROPIC_API_KEY to $ENV_FILE to turn them on)"
fi

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "LetsGo Together is running: http://${IP:-<unraid-ip>}:${PORT}"
echo "Backups: $BACKUPS"
