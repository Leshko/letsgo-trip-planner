# LetsGo Trip Planner

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
  Anyone can suggest; everyone votes ("I'm in"); the list sorts by votes; each
  idea has its own comment thread, and anyone can edit an idea to add
  "good to know" details like hours, price or parking. Any idea can be dropped
  straight onto a day of the plan.
- **First visit** — a short walkthrough shows new members how voting, ideas,
  comments and the plan work. Replay it any time from your avatar menu.
- **Login codes** — from your avatar menu, make a one-time code (10 minutes)
  and type it on another phone or computer to sign in there as you.
- **Profiles** — pick an emoji or upload a photo; it's shrunk on the phone
  before upload and stored with everything else in the SQLite file.
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
- **Install it** — LetsGo is a PWA: on Android/desktop Chrome tap Install; on
  iPhone use Share → Add to Home Screen. Updates arrive with a tap.

Screens poll every few seconds so everyone's phone stays in sync.

## Deploy on Unraid (single container)

See [deploy/README.md](deploy/README.md). Short version, in the Unraid terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/Leshko/letsgo-trip-planner/main/deploy/unraid-deploy.sh | bash
```

One container, one SQLite file, port 3001.

## Run it locally

```bash
pnpm install
pnpm --filter @letsgo/web build     # once; the API serves the built app
pnpm --filter @letsgo/api start     # http://localhost:3001
```

Data lives in a SQLite file at `api/data/letsgo.sqlite`, with uploaded photos
next to it under `api/data/photos/`. Nothing else to set up.

### Develop

```bash
pnpm dev                           # API on :3001 with reload, Angular on :4200 with proxy
```

Open <http://localhost:4200>.

### Test

```bash
pnpm --filter @letsgo/api test      # end-to-end API suite against an in-memory DB
```

## Layout

```
api/   NestJS 11 + TypeORM + SQLite. Trips, members, ideas, votes, comments,
       posts, activity feed, itinerary, photos (files on disk, zip streaming).
       Serves web/dist in production.
web/   Angular 20 (standalone, signals). iOS-style look: system font, translucent
       nav and tab bars, grouped cards, bottom sheets. Light theme only.
```

### Environment

| Variable  | Default                 | Meaning                           |
|-----------|-------------------------|-----------------------------------|
| `PORT`    | `3001`                  | API (and web) port                |
| `DB_PATH` | `api/data/letsgo.sqlite` | SQLite file, or `:memory:`        |
| `UNFURL_ALLOW_PRIVATE` | unset | `1` lets link previews fetch private/local hosts. Dev only. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | generated | Web Push keys. When unset they are generated once and saved to `vapid.json` next to the database. |
| `VAPID_SUBJECT` | `mailto:letsgo@example.com` | Contact for push services; set your email. |
| `PUSH_DISABLED` | unset | `1` skips sending pushes (tests, dev). |

### How access works

A trip has one invite code. Joining with a code and a name creates a member and
returns a bearer token the browser keeps in local storage. Joining again with the
same name on another device hands back the same identity, so Grandma can use her
phone and the iPad. The trip owner (whoever created it) can remove anyone's
ideas, comments and posts; everyone else can remove only their own.
