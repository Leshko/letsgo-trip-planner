#!/bin/bash
# Deploy (or update) LetsGo on an Unraid box. Run this in the Unraid terminal:
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

docker rm -f letsgo >/dev/null 2>&1 || true
docker run -d \
  --name letsgo \
  --restart unless-stopped \
  -p "${PORT}:3001" \
  -v "${DATA}:/data" \
  -e PORT=3001 \
  -e DB_PATH=/data/letsgo.sqlite \
  "$IMAGE"

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "LetsGo is running: http://${IP:-<unraid-ip>}:${PORT}"
