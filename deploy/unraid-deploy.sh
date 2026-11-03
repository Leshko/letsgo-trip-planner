#!/bin/bash
# Deploy or update LetsGo Together on an Unraid box (optional: Unraid's own update
# button works too). Run in the Unraid terminal:
#
#   curl -fsSL https://raw.githubusercontent.com/Leshko/letsgo-trip-planner/main/deploy/unraid-deploy.sh | bash
#
# One container, `letsgo`, on port 3001. Its database is built in; everything lives
# in /mnt/user/appdata/letsgo (database in db/, photos, push keys, backups/).
#
# Settings (AI key, admin key, sign-in email, address) are variables on the
# container: change them in the Unraid Docker tab (LetsGo icon -> Edit). This
# script keeps whatever is set there, and writes the Unraid template so every
# setting has a field. An old letsgo.env file is moved onto the container once.
#
# If the new version doesn't come up healthy, the previous container is put back
# exactly as it was.
#
#   TEMPLATE_ONLY=1 bash unraid-deploy.sh   prints an empty template and exits
set -euo pipefail

IMAGE="${IMAGE:-ghcr.io/leshko/letsgo-trip-planner:latest}"
PORT="${PORT:-3001}"
DATA="${DATA:-/mnt/user/appdata/letsgo}"
ENV_FILE="${ENV_FILE:-${DATA}/letsgo.env}"
TEMPLATES="${TEMPLATES:-/boot/config/plugins/dockerMan/templates-user}"
ICON="https://raw.githubusercontent.com/Leshko/letsgo-trip-planner/main/web/public/icons/icon-192.png"
PROJECT="https://github.com/Leshko/letsgo-trip-planner"
STAMP="$(date +%Y%m%d-%H%M%S)"

# Settings people may set. DATABASE_URL is only kept when a box already uses an
# outside database (an earlier two-container setup); otherwise it's built in.
KEYS=(ANTHROPIC_API_KEY ADMIN_KEY PUBLIC_URL
      SMTP_HOST SMTP_PASS MAIL_FROM SMTP_PORT SMTP_USER
      GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET MICROSOFT_CLIENT_ID MICROSOFT_CLIENT_SECRET MICROSOFT_TENANT
      AI_MODEL AI_ENRICH AI_DAILY_CAP VAPID_SUBJECT DATABASE_URL)

declare -A SET=()
say() { echo "==> $*"; }
is_key() { local k; for k in "${KEYS[@]}"; do [ "$k" = "$1" ] && return 0; done; return 1; }

# ---- the Unraid template (also published as deploy/unraid/my-letsgo.xml) ----
# sed, not ${s//x/y}: bash 5.2 treats & in a replacement as the matched text.
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'; }
var() { # name, key, description, display(always|advanced), mask(true|false)
  printf '  <Config Name="%s" Target="%s" Default="" Mode="" Description="%s" Type="Variable" Display="%s" Required="false" Mask="%s">%s</Config>\n' \
    "$1" "$2" "$(xml "$3")" "$4" "$5" "$(xml "${SET[$2]:-}")"
}
template() {
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
  echo '  <Overview>LetsGo Together: plan a family trip together. One container with its database built in; update with the Docker tab&apos;s update button. It saves a database snapshot to backups/ before every update.</Overview>'
  echo '  <Category>Productivity:</Category>'
  echo "  <WebUI>http://[IP]:[PORT:${PORT}]/</WebUI>"
  echo "  <Icon>${ICON}</Icon>"
  echo '  <ExtraParams>--restart unless-stopped</ExtraParams>'
  echo '  <PostArgs/>'
  echo "  <Config Name=\"Web port\" Target=\"3001\" Default=\"3001\" Mode=\"tcp\" Description=\"Port the app is served on.\" Type=\"Port\" Display=\"always\" Required=\"true\" Mask=\"false\">${PORT}</Config>"
  echo "  <Config Name=\"Data\" Target=\"/data\" Default=\"/mnt/user/appdata/letsgo\" Mode=\"rw\" Description=\"Database, photos, push keys and backups.\" Type=\"Path\" Display=\"always\" Required=\"true\" Mask=\"false\">$(xml "$DATA")</Config>"
  var "Anthropic API key" ANTHROPIC_API_KEY "AI link summaries (from console.anthropic.com). Leave empty to turn them off." always true
  var "Admin key" ADMIN_KEY "Unlocks /admin. 16 characters or more." always true
  var "Public URL" PUBLIC_URL "Main web address, e.g. https://letsgotogether.app. Only set it once that address opens the app." always false
  var "SMTP host" SMTP_HOST "Email for sign-in codes: smtp.resend.com" always false
  var "SMTP password" SMTP_PASS "Your Resend API key (re_...)." always true
  var "Mail from" MAIL_FROM "e.g. LetsGo Together <trips@letsgotogether.app>" always false
  var "SMTP port" SMTP_PORT "Leave empty for Resend (465)." advanced false
  var "SMTP user" SMTP_USER "Leave empty for Resend (resend)." advanced false
  var "Google client ID" GOOGLE_CLIENT_ID "Google sign-in (optional; see the guide)." advanced false
  var "Google client secret" GOOGLE_CLIENT_SECRET "Google sign-in." advanced true
  var "Microsoft client ID" MICROSOFT_CLIENT_ID "Microsoft sign-in (optional; see the guide)." advanced false
  var "Microsoft client secret" MICROSOFT_CLIENT_SECRET "Microsoft sign-in." advanced true
  var "Microsoft tenant" MICROSOFT_TENANT "Leave empty (common)." advanced false
  var "AI model" AI_MODEL "Leave empty for the default." advanced false
  var "AI on/off" AI_ENRICH "0 turns AI summaries off even with a key." advanced false
  var "AI daily cap" AI_DAILY_CAP "Summaries per trip per day (150)." advanced false
  var "Push contact" VAPID_SUBJECT "mailto: address for push services." advanced false
  if [ -n "${SET[DATABASE_URL]:-}" ]; then
    var "Outside database" DATABASE_URL "Only for setups that use a separate database container. Leave as is." advanced true
  fi
  echo '</Container>'
}

if [ "${TEMPLATE_ONLY:-0}" = "1" ]; then template; exit 0; fi

mkdir -p "$DATA"
# The app runs as the unprivileged "node" user (uid 1000).
chown 1000:1000 "$DATA" 2>/dev/null || true
for d in photos backups db; do [ -d "$DATA/$d" ] && chown -R 1000:1000 "$DATA/$d" 2>/dev/null || true; done

if [ "${PULL:-1}" = "1" ]; then
  say "Pulling $IMAGE"
  docker pull "$IMAGE"
fi

# ---- settings: what's on the container (Docker tab) wins; env file and shell only fill gaps ----
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
for k in "${KEYS[@]}"; do
  if [ -n "${!k:-}" ] && [ -z "${SET[$k]:-}" ]; then SET[$k]="${!k}"; fi
done

# ---- set the current container aside (stopped, untouched) so it can be put back ----
PREV=0
if docker inspect letsgo >/dev/null 2>&1; then
  docker rm -f letsgo-previous >/dev/null 2>&1 || true
  docker stop letsgo >/dev/null 2>&1 || true
  docker rename letsgo letsgo-previous
  docker update --restart no letsgo-previous >/dev/null 2>&1 || true
  PREV=1
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
  ${ENV_ARGS[@]+"${ENV_ARGS[@]}"} \
  -l net.unraid.docker.managed=dockerman \
  -l net.unraid.docker.webui="http://[IP]:[PORT:${PORT}]/" \
  -l net.unraid.docker.icon="$ICON" \
  "$IMAGE" >/dev/null

healthy() {
  for i in $(seq 1 90); do
    if docker exec letsgo node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      return 0
    fi
    # Crashing on startup: Docker keeps restarting it; don't wait out the full time.
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
  if [ "$PREV" = "1" ]; then
    echo "!! Putting the previous version back. Your data was not changed."
    docker rename letsgo-previous letsgo
    docker update --restart unless-stopped letsgo >/dev/null 2>&1 || true
    docker start letsgo >/dev/null
  fi
  exit 1
fi

docker logs letsgo 2>&1 | grep -E "Imported the old SQLite database|Skipped rows|Saved a database snapshot" | sed 's/^/   /' || true

# ---- success: clean up ----
docker rm -f letsgo-previous >/dev/null 2>&1 || true
if [ -n "$IMPORTED_FILE" ]; then
  mv "$IMPORTED_FILE" "${IMPORTED_FILE}.imported-${STAMP}"
  chmod 600 "${IMPORTED_FILE}.imported-${STAMP}" 2>/dev/null || true
  say "Moved the settings from $(basename "$IMPORTED_FILE") onto the container. Change them in the Docker tab from now on."
fi
if [ -d "$TEMPLATES" ]; then
  template > "$TEMPLATES/my-letsgo.xml"
  chmod 600 "$TEMPLATES/my-letsgo.xml" 2>/dev/null || true
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
echo "Backups: ${DATA}/backups"
