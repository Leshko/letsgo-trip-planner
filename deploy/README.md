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

Sign-in with Google, Microsoft or an emailed code, and the move to
letsgotogether.app, need a few one-time settings. Do these in order; each is a
few minutes. Nothing breaks if you deploy before finishing: sign-in buttons only
appear once their settings are in place, and the app keeps working at its
current address until `PUBLIC_URL` points somewhere else.

### 1. The address (Cloudflare)

1. In the Cloudflare dashboard, **Domain Registration → Register Domains**, buy
   `letsgotogether.app`.
2. **Zero Trust → Networks → Tunnels**, open the tunnel that already serves
   `letsgo.jeremyleshko.com`, and add a **public hostname**: leave Subdomain
   empty, Domain `letsgotogether.app`, and the **same Service** the existing
   hostname uses (e.g. `http://192.168.86.113:3001`).
3. Keep the old hostname. Phones that open it are moved to the new address
   automatically, still signed in.

### 2. Google

1. <https://console.cloud.google.com> → create a project named "LetsGo Together".
2. **Google Auth Platform** (or **APIs & Services → OAuth consent screen**) →
   **Get started**: app name *LetsGo Together*, your support email, audience
   **External**, your contact email.
3. **Branding**: home page `https://letsgotogether.app`, privacy policy
   `https://letsgotogether.app/privacy`, authorized domain `letsgotogether.app`.
4. **Clients → Create client** → *Web application* → **Authorized redirect URI**
   `https://letsgotogether.app/api/auth/google/callback` → Create. Copy the
   **Client ID** and **Client secret**.
5. **Audience → Publish app**, so anyone can sign in (not just test users). Only
   the basic name-and-email scopes are used, so Google doesn't need to review it.

### 3. Microsoft

1. <https://entra.microsoft.com> (sign in with any Microsoft account) →
   **App registrations → New registration**.
2. Name *LetsGo Together*; supported account types **Accounts in any
   organizational directory and personal Microsoft accounts**; redirect URI
   platform **Web**, `https://letsgotogether.app/api/auth/microsoft/callback`.
   Register.
3. Copy the **Application (client) ID** from the overview.
4. **Certificates & secrets → New client secret** (24 months). Copy its
   **Value** right away (it's shown once) and put a reminder in your calendar to
   make a new one before it expires.

### 4. Email codes (Resend)

1. Sign up at <https://resend.com>. **Domains → Add domain** `letsgotogether.app`.
2. Add the DNS records it shows (the **Sign in to Cloudflare** button adds them
   for you) and press **Verify**.
3. **API Keys → Create API key** with sending access. Copy it (starts with `re_`).

### 5. Settings

**First check that `https://letsgotogether.app` opens the app** (step 1). The
moment `PUBLIC_URL` is set, phones on the old address are sent there, so it has
to work before you add it.

Docker tab → LetsGo icon → **Edit**, fill in (open **Show more settings** for
the SMTP port and user):

| Field | Value |
|-------|-------|
| Public URL | `https://letsgotogether.app` |
| Google client ID / secret | from step 2 |
| Microsoft client ID / secret | from step 3 |
| SMTP host | `smtp.resend.com` |
| SMTP port | `465` |
| SMTP user | `resend` |
| SMTP password | your Resend key (`re_...`) |
| Mail from | `LetsGo Together <trips@letsgotogether.app>` |

**Apply**. Then open
`https://letsgotogether.app/signin`: the Google, Microsoft and email options
should all be there.

What people notice: the next time anyone opens the old address, they land on
letsgotogether.app, still in their trip, with a one-time card asking them to
turn notifications back on and add the app to their home screen again (phones
treat a new address as a new app). Starting a new trip now needs a free
account; joining a trip still only needs a name.
