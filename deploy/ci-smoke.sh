#!/bin/bash
# Smoke test for the built image, run in CI before anything is published.
# Simulates what Unraid's update button does to an existing install: a container
# on the old single-file version is replaced by the new image with the same data
# folder and settings. Then stop, start and a hard kill, as a reboot would.
set -euo pipefail
IMG="${1:?image}"
FIX=api/test/fixtures/legacy-v1
D="$(mktemp -d)"
URL=http://127.0.0.1:3101

fail() {
  echo "SMOKE FAILED at line $1: $2"
  docker logs --tail 120 smoke 2>&1 || true
  sudo ls -la "$D" "$D/backups" 2>/dev/null || true
  exit 1
}
trap 'fail $LINENO "$BASH_COMMAND"' ERR

cp "$FIX/letsgo.sqlite" "$D/"; cp -r "$FIX/photos" "$D/photos"
sudo chown -R 1000:1000 "$D" 2>/dev/null || chown -R 1000:1000 "$D"
MOM=$(python3 -c "import json;print(json.load(open('$FIX/ids.json'))['momToken'])")

up() {
  for i in $(seq 1 120); do
    if curl -sf "$URL/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "app did not come up within 120s"; return 1
}
logs() { docker logs smoke 2>&1 || true; }
has() { [[ "$1" == *"$2"* ]]; }
check() {
  local me admin page
  me=$(curl -sf -H "Authorization: Bearer $MOM" "$URL/api/trips/me")
  has "$me" '"name":"Mom"'
  admin=$(curl -sf -H "X-Admin-Key: ci-admin-key-0123456789" "$URL/api/admin/trips")
  python3 -c "import sys,json;t=json.loads(sys.argv[1]);assert len(t)==2, t" "$admin"
  page=$(curl -sf "$URL/")
  has "$page" "<title>LetsGo Together</title>"
}

echo "== start the new image on an old single-file install"
docker run -d --name smoke --restart unless-stopped -p 3101:3001 -v "$D:/data" \
  -e PORT=3001 -e DB_PATH=/data/letsgo.sqlite -e ADMIN_KEY=ci-admin-key-0123456789 \
  `# every other Unraid template field, empty, exactly as the Docker tab passes them` \
  -e ANTHROPIC_API_KEY= -e PUBLIC_URL= -e SMTP_HOST= -e SMTP_PASS= -e MAIL_FROM= -e SMTP_PORT= -e SMTP_USER= \
  -e GOOGLE_CLIENT_ID= -e GOOGLE_CLIENT_SECRET= -e MICROSOFT_CLIENT_ID= -e MICROSOFT_CLIENT_SECRET= \
  -e MICROSOFT_TENANT= -e AI_MODEL= -e AI_ENRICH= -e AI_DAILY_CAP= -e VAPID_SUBJECT= \
  -e APPLE_TEAM_ID= -e APNS_KEY_ID= -e APNS_KEY= -e FCM_SERVICE_ACCOUNT= -e ANDROID_CERT_SHA256= \
  "$IMG" >/dev/null
up; check
L=$(logs); has "$L" "Imported the old SQLite database"
docker exec smoke test -f /data/backups/letsgo-before-postgres.sqlite
echo "   imported, signed in, admin ok"

echo "== clean stop and start"
t0=$(date +%s); docker stop -t 30 smoke >/dev/null; echo "   stopped in $(( $(date +%s) - t0 ))s"
L=$(logs); has "$L" "database system is shut down"
docker start smoke >/dev/null; up; check
L=$(logs); [ "$(grep -c 'Imported the old SQLite database' <<<"$L")" = "1" ]
echo "   same data, no second import"

echo "== hard kill, then start"
docker kill smoke >/dev/null; docker start smoke >/dev/null; up; check
echo "   starts fine"

docker rm -f smoke >/dev/null
echo "SMOKE OK"
