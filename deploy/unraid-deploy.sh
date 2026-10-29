#!/bin/bash
# Deploy (or update) LetsGo Together on an Unraid box. Run this in the Unraid terminal:
#
#   curl -fsSL https://raw.githubusercontent.com/Leshko/letsgo-trip-planner/main/deploy/unraid-deploy.sh | bash
#
# Pulls the image GitHub Actions publishes, keeps data in /mnt/user/appdata/letsgo,
# and exposes the app on port 3001 (change PORT below if that clashes).
set -euo pipefail

IMAGE="${IMAGE:-ghcr.io/leshko/letsgo-trip-planner:latest}"
PORT="${PORT:-3001}"
DATA="${DATA:-/mnt/user/appdata/letsgo}"

mkdir -p "$DATA"
# The image runs as the unprivileged "node" user (uid 1000).
chown 1000:1000 "$DATA" 2>/dev/null || true

echo "Pulling $IMAGE"
docker pull "$IMAGE"

# Optional settings (AI link summaries etc.) live in an env file next to the data,
# so secrets never pass through shell history. Shell variables also pass through.
ENV_FILE="${ENV_FILE:-${DATA}/letsgo.env}"
EXTRA=()
if [ -f "$ENV_FILE" ]; then
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  EXTRA+=(--env-file "$ENV_FILE")
fi
for v in ANTHROPIC_API_KEY AI_MODEL AI_ENRICH AI_DAILY_CAP VAPID_SUBJECT; do
  if [ -n "${!v:-}" ]; then EXTRA+=(-e "$v=${!v}"); fi
done

docker rm -f letsgo >/dev/null 2>&1 || true
docker run -d \
  --name letsgo \
  --restart unless-stopped \
  -p "${PORT}:3001" \
  -v "${DATA}:/data" \
  -e PORT=3001 \
  -e DB_PATH=/data/letsgo.sqlite \
  "${EXTRA[@]}" \
  "$IMAGE"

if [ -n "${ANTHROPIC_API_KEY:-}" ] || { [ -f "$ENV_FILE" ] && grep -q '^ANTHROPIC_API_KEY=' "$ENV_FILE"; }; then
  echo "AI link summaries: on"
else
  echo "AI link summaries: off (add ANTHROPIC_API_KEY to $ENV_FILE to turn them on)"
fi

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "LetsGo Together is running: http://${IP:-<unraid-ip>}:${PORT}"
