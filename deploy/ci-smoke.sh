#!/bin/bash
# Smoke test for the built image, run in CI before anything is published.
# Simulates what Unraid's update button does to an existing install: a container
# on the old single-file version is replaced by the new image with the same data
# folder and settings. Then stop, start and a hard kill, as a reboot would.
set -euo pipefail
IMG="${1:?image}"
FIX=api/test/fixtures/legacy-v1
D="$(mktemp -d)"
cp "$FIX/letsgo.sqlite" "$D/"; cp -r "$FIX/photos" "$D/photos"
sudo chown -R 1000:1000 "$D" 2>/dev/null || chown -R 1000:1000 "$D"
MOM=$(python3 -c "import json;print(json.load(open('$FIX/ids.json'))['momToken'])")
URL=http://127.0.0.1:3101

up() {
  for i in $(seq 1 120); do curl -sf "$URL/api/health" >/dev/null && return 0; sleep 1; done
  echo "app did not come up"; docker logs --tail 80 smoke; return 1
}
check() {
  local name
  name=$(curl -sf -H "Authorization: Bearer $MOM" "$URL/api/trips/me" | python3 -c "import sys,json;print(json.load(sys.stdin)['member']['name'])")
  [ "$name" = "Mom" ] || { echo "expected Mom, got '$name'"; docker logs --tail 80 smoke; return 1; }
  curl -sf -H "X-Admin-Key: ci-admin-key-0123456789" "$URL/api/admin/trips" | python3 -c "import sys,json;t=json.load(sys.stdin);assert len(t)==2, t"
  curl -sf "$URL/" | grep -q "<title>LetsGo Together</title>"
}

docker run -d --name smoke --restart unless-stopped -p 3101:3001 -v "$D:/data" \
  -e PORT=3001 -e DB_PATH=/data/letsgo.sqlite -e ADMIN_KEY=ci-admin-key-0123456789 "$IMG" >/dev/null
up; check
docker logs smoke 2>&1 | grep -q "Imported the old SQLite database"
[ -f "$D/backups/letsgo-before-postgres.sqlite" ]
echo "first start: imported, signed in, admin ok"

t0=$(date +%s); docker stop -t 30 smoke >/dev/null; echo "stopped in $(( $(date +%s) - t0 ))s"
docker logs smoke 2>&1 | grep -q "database system is shut down"
docker start smoke >/dev/null; up; check
[ "$(docker logs smoke 2>&1 | grep -c 'Imported the old SQLite database')" = "1" ]
echo "restart: same data, no second import"

docker kill smoke >/dev/null; docker start smoke >/dev/null; up; check
echo "after a hard kill: starts fine"

docker rm -f smoke >/dev/null
echo "SMOKE OK"
