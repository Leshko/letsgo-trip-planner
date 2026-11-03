# Deploying LetsGo Together

## Unraid (one command)

Open the Unraid terminal (top-right `>_` icon) and run:

```bash
curl -fsSL https://raw.githubusercontent.com/Leshko/letsgo-trip-planner/main/deploy/unraid-deploy.sh | bash
```

Then open `http://<unraid-ip>:3001`. Run the same command again any time to update.

It runs two containers on Docker's standard bridge:

| Container   | What it is                    | Data                                        |
|-------------|-------------------------------|---------------------------------------------|
| `letsgo-db` | PostgreSQL 16, reachable only from containers on this server | `/mnt/user/appdata/letsgo/postgres` |
| `letsgo`    | the app, port 3001            | photos and push keys in `/mnt/user/appdata/letsgo` |

## Settings live in the Docker tab

Every setting (AI key, admin key, sign-in, email) is a variable on the `letsgo`
container, and the Docker tab is the source of truth: click the LetsGo icon →
**Edit**, change a field, **Apply**. Secret fields are masked. Running the deploy
line again keeps whatever is set there. (If you used a `letsgo.env` file
before, the first deploy moves its values onto the container and renames the
file to `letsgo.env.imported-<date>`.)

Updating: either run the deploy line (database snapshot first, automatic
rollback) or use the Docker tab's **apply update**; both keep your settings.

The database password is generated on the first run and kept in
`/mnt/user/appdata/letsgo/db.env` (only root can read it).

**Upgrading from the single-container version** happens on its own the first
time you run the command: the script copies `letsgo.sqlite` to
`backups/letsgo-before-postgres.sqlite`, starts PostgreSQL, and the app copies
every trip, person, vote, comment, photo record and sign-in across, checks every
table's count, and only then starts. Everyone stays signed in. The old
`letsgo.sqlite` is left exactly as it was.

If the pull is refused, the package is still private on GitHub: on github.com
open your profile → Packages → `letsgo-trip-planner` → Package settings → Change visibility →
Public. (Or `docker login ghcr.io` on the box with a personal access token that
has `read:packages`.)

## Photos and disk space

Uploaded photos are stored as files under `/mnt/user/appdata/letsgo/photos`,
and the database lives in `/mnt/user/appdata/letsgo/postgres`, so backing up
`/mnt/user/appdata/letsgo` covers everything. Originals
are kept at full size (up to 25 MB each).

If you put a reverse proxy in front (Nginx Proxy Manager, SWAG, nginx), raise
its upload limit or large photos will fail with 413:

```
client_max_body_size 30m;
proxy_read_timeout 300s;
```

Cloudflare Tunnel's 100 MB request limit is fine as is.

## Push notifications

Push keys are generated on first start and saved to `/data/vapid.json`, so they
survive updates as long as the appdata folder does. If that file is ever lost,
everyone just turns notifications on again from their avatar menu. Push needs the
app served over HTTPS for anything but `localhost`, so for phones outside the
house put LetsGo Together behind your reverse proxy with a certificate; on the LAN,
Chrome treats plain `http://192.168.x.x` as insecure and won't offer push.
iPhone users add the app to their Home Screen first.

## AI link summaries (optional)

When someone pastes a link to a restaurant or activity, LetsGo Together can have Claude
read the page and fill in a family-friendly summary, address, phone, hours, price
level and the best photo. It uses the cheapest current model (Claude Haiku 5.5):
a new link costs well under a tenth of a cent, repeats are free for a week, and
each trip is capped at 150 summaries a day. A Claude.ai subscription does not
cover this; it needs an API key:

1. Go to https://console.anthropic.com, create an account if needed, open
   **Billing** and add a few dollars of credit.
2. Open **API Keys**, create a key, and copy it (it starts with `sk-ant-`).
3. Docker tab → LetsGo icon → **Edit** → paste it into **Anthropic API key** →
   **Apply**.

Under **Show more settings** there's also the AI model (default
`claude-haiku-5-5`), the daily cap (default 150 per trip per day) and an on/off
switch (`0` turns it off).

Privacy: only the text and image links of the pasted page are sent to Anthropic.
Nothing about your trip, family or photos leaves the box, and nothing is sent at
all without a key.

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

## Backups and rolling back

Every update first saves a database snapshot to
`/mnt/user/appdata/letsgo/backups/letsgo-<date>.sql.gz` (the last 10 are kept).
If the new version doesn't start, the script puts the previous one back by
itself and says so; nothing in the database has changed in that case.

To restore a snapshot by hand:

```bash
docker stop letsgo
gunzip -c /mnt/user/appdata/letsgo/backups/letsgo-<date>.sql.gz | \
  docker exec -i letsgo-db sh -c 'psql -U letsgo -d postgres -c "DROP DATABASE letsgo WITH (FORCE)" -c "CREATE DATABASE letsgo" && psql -U letsgo -d letsgo'
docker start letsgo
```

## Admin screen

`/admin` shows every trip on the server with its join link, who is in it,
and what each person has added. If someone lost the trip on their phone and
rejoined under a different name, merge their new spot into their original one
there: everything they did moves over, and their phone opens the original spot
from then on.

It's off until you give it a key: Docker tab → LetsGo icon → **Edit** → **Admin
key** (16 characters or more; a password manager's generator is handy) →
**Apply**. Then open `https://<your address>/admin` and type it. Tap **Lock** on
a shared device when you're done.

## Accounts and the letsgotogether.app address

Sign-in is by email: people type their address and get a 6-digit code (no
passwords). The app also moves to letsgotogether.app, and phones that open
letsgo.jeremyleshko.com are carried over automatically, still signed in.
Until email is set up, everything works as before, including starting trips.

### 1. Install the release

Run the deploy line at the top of this page once.

### 2. Check that letsgotogether.app reaches this same app

Open `https://letsgotogether.app/admin`, unlock it, and check your trips are
listed; `https://letsgotogether.app/api/health` should show `{"ok":true}`. Both
addresses must reach the same `letsgo` container: phones are moved from one to
the other.

(No tunnel for it yet? In Cloudflare **Zero Trust → Networks → Tunnels**, open
the tunnel that serves letsgo.jeremyleshko.com and add a public hostname for
`letsgotogether.app` with the **same Service**.)

### 3. Resend (sends the sign-in codes)

1. Sign up at <https://resend.com> (the free plan sends 3,000 emails a month).
2. **Domains → Add Domain** → `letsgotogether.app`. Let it add the DNS records
   in Cloudflare (or add them yourself as "DNS only"), then **Verify DNS
   Records**.
3. **API Keys → Create API Key**, sending access, limited to letsgotogether.app.
   Copy the key (starts with `re_`; it's shown once).

### 4. Turn on email sign-in

Docker tab → LetsGo icon → **Edit**:

| Field | Value |
|-------|-------|
| SMTP host | `smtp.resend.com` |
| SMTP password | your Resend key (`re_...`) |
| Mail from | `LetsGo Together <trips@letsgotogether.app>` |

**Apply**, then open `https://letsgo.jeremyleshko.com/signin` and send yourself
a code. (Port and user fill themselves in for Resend.)

### 5. Move to the new address

Once the code arrives: **Edit** again → **Public URL** `https://letsgotogether.app`
→ **Apply**. From then on, anyone opening the old address lands on
letsgotogether.app in the same trip, with a one-time card asking them to turn
notifications back on and add the app to their home screen again (phones treat
a new address as a new app). Starting a new trip now needs signing in; joining
a trip still only needs a name.

### Saving someone's spot to their email

On `/admin`, open a trip's people and use **Link email** next to anyone. Their
spot is saved to the account for that address (created if needed); when they
sign in with an emailed code to it, the trip is in their My trips.

### Later: Google and Microsoft sign-in

Optional extra buttons on the sign-in screen. They appear once their fields are
filled in (under **Show more settings** in the Docker tab).

**Google:** <https://console.cloud.google.com> → new project → **Google Auth
Platform → Get started** (External; support email) → **Branding**: home page
`https://letsgotogether.app`, privacy policy `https://letsgotogether.app/privacy`,
authorized domain `letsgotogether.app` → **Clients → Create client** → Web
application, redirect URI `https://letsgotogether.app/api/auth/google/callback`
→ copy the client ID and secret → **Audience → Publish app**.

**Microsoft:** <https://entra.microsoft.com> → **App registrations → New
registration** → "Accounts in any organizational directory and personal
Microsoft accounts", Web redirect
`https://letsgotogether.app/api/auth/microsoft/callback` → copy the
Application (client) ID → **Certificates & secrets → New client secret** (copy
the Value; set a reminder before it expires).
