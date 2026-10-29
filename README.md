# LetsGo Together

Plan the family trip together.

A social planner for a group vacation. One person starts a trip and gets a short
invite code; everyone else opens the link, types their name, and is in. No
accounts, no passwords.

What the family can do:

- **Home** — countdown, who's in, the current top-voted activities and restaurants,
  the latest wall post, and a live "what's happening" feed (who joined, who
  suggested what, who's in for what, who put what on the plan).
- **Stay** — the hotel / cabin / rental: photos, address with an embedded map and
  one-tap directions, check-in and check-out, the listing link, and notes for the
  family (door code, parking, who sleeps where).
- **Ideas** — To do and To eat lists. Paste a link and the title, description
  and photos are pulled from the page (like a share sheet); pick a cover photo.
  With an Anthropic API key set, Claude reads the page too and fills in a
  family-friendly summary, address, hours, price and "good to know" details.
  Anyone can suggest; everyone votes ("I'm in"); the list sorts by votes; each
  idea has its own comment thread, and anyone can edit an idea to add
  "good to know" details like hours, price or parking. Any idea can be dropped
  straight onto a day of the plan.
- **First visit** — a short walkthrough shows new members how voting, ideas,
  comments and the plan work. Replay it any time from your avatar menu.
- **Login codes** — from your avatar menu, make a one-time code (10 minutes)
  and type it on another phone or computer to sign in there as you.
- **Profiles** — pick an emoji or upload a photo; it's shrunk on the phone
  before upload and stored in the database.
- **Plan** — a day-by-day itinerary generated from the trip dates. Add entries
  from the idea list or write your own, give them a time or leave them "anytime",
  and drag them between days.
- **Wall** — a shared message board with emoji reactions.
- **Photos** — the family album. Anyone adds photos from their phone (originals
  are kept; thumbnails and previews are made on the phone before upload), everyone
  can view, comment, download one, or grab them all as a zip.
- **Notifications** — a bell with an unread list, and push notifications to the
  phone (Android/desktop Chrome right away; iPhone once the app is on the Home
  Screen). Each person chooses what to get: new ideas, votes on their ideas,
  comments, wall posts, plan changes, photos, new members.
- **Tap any idea** for its own page: cover, details, map, who's in, comments,
  add to plan, edit, and a Share button that copies a link. Links carry the
  invite code, so a relative who isn't signed in joins and lands on the idea.
- **Accounts** — sign in with Google, Microsoft or a 6-digit code emailed to
  you (no passwords). *My trips* lists every trip you're part of, on any device.
  Starting a trip needs an account; joining one only needs a name, and people
  can save their spot to an account later without losing anything.
- **Admin** — `/admin` (unlocked with `ADMIN_KEY`) lists every trip with its
  join link and lets you merge a person who rejoined under a new name back into
  their original spot.
- **Install it** — LetsGo Together is a PWA: on Android/desktop Chrome tap Install; on
  iPhone use Share → Add to Home Screen. Updates arrive with a tap.

Screens poll every few seconds so everyone's phone stays in sync.

## Deploy on Unraid

See [deploy/README.md](deploy/README.md). Short version, in the Unraid terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/Leshko/letsgo-trip-planner/main/deploy/unraid-deploy.sh | bash
```

Two containers (the app and PostgreSQL), port 3001. The setup for sign-in and
the letsgotogether.app address is in the same guide.

## Run it locally

```bash
docker run -d --name letsgo-pg -e POSTGRES_USER=letsgo -e POSTGRES_PASSWORD=letsgo -p 5432:5432 postgres:16-alpine
export DATABASE_URL=postgres://letsgo:letsgo@localhost:5432/letsgo
pnpm install
pnpm --filter @letsgo/web build     # once; the API serves the built app
pnpm --filter @letsgo/api start     # http://localhost:3001
```

The schema is created by the migrations in `api/src/migrations` on startup.
Uploaded photos go to `api/data/photos/`. Set `MAIL_DEV_OUTBOX=memory` (or a
file path) to sign in with emailed codes without an email service.

### Develop

```bash
pnpm dev                           # API on :3001 with reload, Angular on :4200 with proxy
```

Open <http://localhost:4200>.

### Test

```bash
pnpm --filter @letsgo/api test      # end-to-end suite; each suite gets a fresh Postgres database
# uses TEST_PG_ADMIN_URL, default postgres://letsgo:letsgo@127.0.0.1:5432/postgres
```

## Layout

```
api/   NestJS 11 + TypeORM + PostgreSQL. Accounts, trips, members, ideas, votes, comments,
       posts, activity feed, itinerary, photos (files on disk, zip streaming).
       Serves web/dist in production.
web/   Angular 20 (standalone, signals). iOS-style look: system font, translucent
       nav and tab bars, grouped cards, bottom sheets. Light theme only.
```

### Environment

| Variable  | Default                 | Meaning                           |
|-----------|-------------------------|-----------------------------------|
| `PORT`    | `3001`                  | API (and web) port                |
| `DATABASE_URL` | required | PostgreSQL connection string. |
| `DATA_DIR` | `api/data` | Photos, push keys. |
| `DB_PATH` | `<DATA_DIR>/letsgo.sqlite` | The old SQLite file, imported once on first start if present. |
| `PUBLIC_URL` | unset | The app's main address, e.g. `https://letsgotogether.app`. Sign-in redirects and emailed links use it; other addresses hand phones over to it. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | unset | Google sign-in. |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | unset | Microsoft sign-in (`MICROSOFT_TENANT`, default `common`). |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `MAIL_FROM` | unset | Email for sign-in codes (e.g. Resend). |
| `MAIL_DEV_OUTBOX` | unset | `memory` or a file path: keep emails instead of sending. Dev and tests only. |
| `ADMIN_KEY` | unset | Turns on `/admin` (16+ characters). |
| `UNFURL_ALLOW_PRIVATE` | unset | `1` lets link previews fetch private/local hosts. Dev only. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | generated | Web Push keys. When unset they are generated once and saved to `vapid.json` next to the database. |
| `VAPID_SUBJECT` | `mailto:letsgo@example.com` | Contact for push services; set your email. |
| `PUSH_DISABLED` | unset | `1` skips sending pushes (tests, dev). |
| `ANTHROPIC_API_KEY` | unset | Turns on AI link summaries (Claude). Without it the basic preview is used. |
| `AI_MODEL` | `claude-haiku-5-5` | Model for link summaries. |
| `AI_DAILY_CAP` | `150` | Max AI summaries per trip per day. |
| `AI_ENRICH` | unset | `0` disables AI summaries even with a key. |
| `AI_FAKE` | unset | `1` uses a deterministic fake AI client. Dev and tests only. |

### How access works

Starting a trip needs an account (Google, Microsoft or emailed code). A trip has
one invite code. Joining with a code and a name creates a member and returns a
bearer token the browser keeps in local storage; signing in later saves that
spot to the account. A spot saved to an account can't be taken over by typing
the same name. Joining again with the
same name on another device hands back the same identity, so Grandma can use her
phone and the iPad. The trip owner (whoever created it) can remove anyone's
ideas, comments and posts; everyone else can remove only their own.
