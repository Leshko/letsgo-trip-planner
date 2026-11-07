// Store screenshots at the sizes Apple and Google ask for, from a demo family trip.
//
//   node deploy/stores/screenshots.js http://localhost:3001 out-folder
//
// Needs a running LetsGo server (an empty test one is best: it creates demo
// trips) and Playwright. Apple: 6.9" iPhone, 1320x2868. Google: phone 1080x1920.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:3001';
const OUT = path.resolve(process.argv[3] || 'store-screenshots');
const iso = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
};

async function api(method, p, body, token) {
  const r = await fetch(`${BASE}/api${p}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}

async function demoTrip(start, end, name) {
  const t = await api('POST', '/trips', { name, destination: 'Lake Tahoe', startDate: iso(start), endDate: iso(end), memberName: 'Mom' });
  const id = t.trip.id;
  const people = { Mom: t.token };
  await api('PATCH', '/trips/me', { emoji: '🌻' }, t.token);
  for (const [who, emoji] of [['Dad', '🎣'], ['Grandma', '🧶'], ['Jake', '🏀'], ['Emma', '🦄']]) {
    const m = await api('POST', '/trips/join', { code: t.trip.inviteCode, name: who });
    people[who] = m.token;
    await api('PATCH', '/trips/me', { emoji }, m.token);
  }
  await api('PUT', `/trips/${id}/lodging`, { name: 'The Pine Cabin', address: '123 Lakeshore Dr, Tahoe City, CA', checkIn: '4:00 pm', checkOut: '11:00 am', link: '', notes: 'Door code 4821. Kayaks are under the deck.', photos: [] }, t.token);
  const ideas = [];
  for (const [kind, title, address, by, voters] of [
    ['activity', 'Kayak at Sand Harbor', '2005 NV-28, Incline Village, NV', 'Dad', ['Mom', 'Jake', 'Emma', 'Grandma']],
    ['activity', 'Gondola ride at Heavenly', '4080 Lake Tahoe Blvd, South Lake Tahoe, CA', 'Emma', ['Jake', 'Emma', 'Mom']],
    ['activity', 'Emerald Bay hike', 'Emerald Bay State Park, CA', 'Jake', ['Dad', 'Jake']],
    ['food', "Gar Woods Grill & Pier", '5000 N Lake Blvd, Carnelian Bay, CA', 'Grandma', ['Grandma', 'Mom', 'Dad', 'Emma']],
    ['food', 'Fire Sign Cafe (breakfast)', '1785 W Lake Blvd, Tahoe City, CA', 'Mom', ['Mom', 'Dad']],
  ]) {
    const idea = await api('POST', `/trips/${id}/ideas`, { kind, title, address }, people[by]);
    for (const v of voters) await api('POST', `/trips/${id}/ideas/${idea.id}/vote`, {}, people[v]).catch(() => undefined);
    ideas.push(idea);
  }
  await api('POST', `/trips/${id}/itinerary`, { date: iso(0), startTime: '09:00', title: 'Fire Sign Cafe (breakfast)', ideaId: ideas[4].id }, t.token);
  await api('POST', `/trips/${id}/itinerary`, { date: iso(0), startTime: '11:00', title: 'Kayak at Sand Harbor', ideaId: ideas[0].id }, t.token);
  await api('POST', `/trips/${id}/itinerary`, { date: iso(0), startTime: '18:30', title: "Dad's birthday dinner", ideaId: ideas[3].id, notes: 'Table for 5 under Smith' }, t.token);
  await api('POST', `/trips/${id}/itinerary`, { date: iso(1), startTime: '10:00', title: 'Gondola ride at Heavenly', ideaId: ideas[1].id }, t.token);
  for (const [who, body] of [
    ['Grandma', 'Made it! The cabin is beautiful 😍'],
    ['Jake', 'Who wants the double kayak with me?'],
    ['Emma', 'Bringing the birthday banner, nobody tell Dad 🤫'],
  ])
    await api('POST', `/trips/${id}/posts`, { body }, people[who]);
  // Shown as Emma: not the organizer, so no "save this trip" card. No unread badge either.
  await api('POST', `/trips/${id}/notifications/read`, {}, people.Emma);
  return { id, token: people.Emma };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const live = await demoTrip(-1, 3, 'Smith Family Lake Week');
  const later = await demoTrip(24, 29, 'Smith Family Lake Week');
  const browser = await chromium.launch();
  const devices = [
    { name: 'iphone-6.9', viewport: { width: 440, height: 956 }, deviceScaleFactor: 3 },
    // Google allows at most 2:1, so a 9:16 phone shot.
    { name: 'android-phone', viewport: { width: 360, height: 640 }, deviceScaleFactor: 3 },
  ];
  for (const d of devices) {
    for (const [file, trip, route, ready] of [
      ['1-today', live, '/trip', '[data-testid=today-plan] .today-entry'],
      ['2-ideas', later, '/trip/ideas/do', '.idea'],
      ['3-plan', live, '/trip/plan', 'h1, h2'],
      ['4-wall', live, '/trip/wall', '.post'],
      ['5-countdown', later, '/trip', '.countdown'],
    ]) {
      const ctx = await browser.newContext({ viewport: d.viewport, deviceScaleFactor: d.deviceScaleFactor, isMobile: true, hasTouch: true });
      await ctx.addInitScript(([tok, tripId]) => {
        localStorage.setItem('letsgo.token', tok);
        localStorage.setItem('letsgo.tour.v1', '1');
        localStorage.setItem('letsgo.whatsnew.v2', '1');
        localStorage.setItem('letsgo.install.dismissed', String(Date.now()));
        localStorage.setItem(`letsgo.letsGoIntro.${tripId}`, '1');
        localStorage.setItem(`letsgo.savePrompt.${tripId}`, String(Date.now()));
      }, [trip.token, trip.id]);
      const page = await ctx.newPage();
      await page.goto(BASE + route);
      await page.locator(ready).first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, `${d.name}-${file}.png`) });
      await ctx.close();
    }
  }
  await browser.close();
  console.log(`Screenshots in ${OUT}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
