# Deploying LetsGo

## Unraid (one command)

Open the Unraid terminal (top-right `>_` icon) and run:

```bash
curl -fsSL https://raw.githubusercontent.com/Leshko/letsgo-trip-planner/main/deploy/unraid-deploy.sh | bash
```

Then open `http://<unraid-ip>:3001`. Data persists in `/mnt/user/appdata/letsgo`.
Run the same command again any time to update.

If the pull is refused, the package is still private on GitHub: on github.com
open your profile → Packages → `letsgo-trip-planner` → Package settings → Change visibility →
Public. (Or `docker login ghcr.io` on the box with a personal access token that
has `read:packages`.)

## Photos and disk space

Uploaded photos are stored as files under `/data/photos` next to the SQLite
database, so backing up `/mnt/user/appdata/letsgo` covers everything. Originals
are kept at full size (up to 25 MB each).

If you put a reverse proxy in front (Nginx Proxy Manager, SWAG, nginx), raise
its upload limit or large photos will fail with 413:

```
client_max_body_size 30m;
proxy_read_timeout 300s;
```

Cloudflare Tunnel's 100 MB request limit is fine as is.

## Build from source instead

On any box with Docker:

```bash
git clone https://github.com/Leshko/letsgo-trip-planner.git
cd letsgo-trip-planner
docker compose up -d --build
```

## Reaching it from outside the house

The app is designed for a family on different networks. Put it behind whatever
you already use on Unraid (Nginx Proxy Manager, SWAG, Cloudflare Tunnel,
Tailscale) and share that URL. Invite links are `https://<your-host>/join/<CODE>`.
