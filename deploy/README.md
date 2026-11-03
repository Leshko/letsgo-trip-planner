# Deploying LetsGo Together

## Unraid

LetsGo Together is one container, `letsgo`, on port 3001. Its database is built
in, so everything lives in `/mnt/user/appdata/letsgo`:

| Folder / file | What it is |
|---------------|------------|
| `db/` | the database (PostgreSQL 16, only reachable inside the container) |
| `photos/` | uploaded photos |
| `backups/` | a database snapshot before every update (last 10) |
| `vapid.json`, `db.password` | push-notification keys, database password |
| `letsgo.sqlite` | the old single-file database, kept untouched after it's imported |

### Updating

Docker tab → **Check for Updates** → **apply update** on LetsGo. That's all: the
app saves a database snapshot to `backups/` before it changes anything, and the
first update from the old single-file version copies every trip, person, vote,
comment, photo and sign-in into the new database (checking every table's count),
so everyone stays signed in.

To go back a version: Docker tab → LetsGo → **Edit** → set **Repository** to
`ghcr.io/leshko/letsgo-trip-planner:<version>` (every build is also tagged with
its short commit id, listed on the GitHub packages page) → **Apply**.

### Installing from scratch

In the Unraid terminal, fetch the template (every setting as a field, ready to
fill in):

```bash
curl -fsSL https://raw.githubusercontent.com/Leshko/letsgo-trip-planner/main/deploy/unraid/my-letsgo.xml \
  -o /boot/config/plugins/dockerMan/templates-user/my-letsgo.xml
mkdir -p /mnt/user/appdata/letsgo && chown 1000:1000 /mnt/user/appdata/letsgo
```

Then Docker tab → **Add Container** → Template: **letsgo** → fill in the fields →
**Apply**, and open `http://<unraid-ip>:3001`.

Or do all of that with one command (it also works for updates, and puts the
previous container back by itself if a new version doesn't start):

```bash
curl -fsSL https://raw.githubusercontent.com/Leshko/letsgo-trip-planner/main/deploy/unraid-deploy.sh | bash
```

If the pull is refused, the package is still private on GitHub: on github.com
open your profile → Packages → `letsgo-trip-planner` → Package settings → Change
visibility → Public.

## Settings live in the Docker tab

Every setting (AI key, admin key, sign-in email, address) is a variable on the
`letsgo` container: click the LetsGo icon → **Edit**, change a field, **Apply**.
Secret fields are masked. (The deploy line keeps whatever is set there, and
moves an old `letsgo.env` file onto the container once.)

Boxes that ran the earlier two-container version keep their separate
`letsgo-db` container: the app finds it through the **Outside database** field
(under Show more settings). Leave that field as it is.

## Photos and disk space

Uploaded photos are stored as files under `/mnt/user/appdata/letsgo/photos`,
and the database in `/mnt/user/appdata/letsgo/db`, so backing up
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

Before every update that changes the database, the app saves
`/mnt/user/appdata/letsgo/backups/letsgo-<date>.sql.gz` (the last 10 are kept).
To restore one by hand:

```bash
docker exec -i letsgo sh -c 'P=$(cat /data/db.password); export PGPASSWORD=$P; $PG_BIN/dropdb -h 127.0.0.1 -U letsgo letsgo && $PG_BIN/createdb -h 127.0.0.1 -U letsgo letsgo && gunzip -c /data/backups/letsgo-<date>.sql.gz | $PG_BIN/psql -q -h 127.0.0.1 -U letsgo -d letsgo'
docker restart letsgo
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

Update LetsGo from the Docker tab (see Updating, above).

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
