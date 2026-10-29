import {
  bestAddress,
  buildDigest,
  DIGEST_MAX_CHARS,
  isThin,
  renderDigest,
} from '../src/unfurl/unfurl.digest';
import { parseUnfurl } from '../src/unfurl/unfurl.parser';

const filler = Array.from(
  { length: 400 },
  (_, i) =>
    `<p>Paragraph ${i} about the lake, the trails, and the quiet mornings by the water.</p>`,
).join('');

const html = `<!doctype html><html><head>
  <title>Marina Taco Truck | Tahoe</title>
  <meta property="og:title" content="Marina Taco Truck">
  <meta property="og:description" content="Baja-style fish tacos on the water.">
  <meta property="og:image" content="/img/cover.jpg">
  <meta property="og:image:alt" content="Tacos on a paper boat">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Restaurant","name":"Marina Taco Truck",
   "address":{"@type":"PostalAddress","streetAddress":"700 N Lake Blvd","addressLocality":"Tahoe City","addressRegion":"CA","postalCode":"96145"},
   "telephone":"+1 530-555-0199","priceRange":"$$","servesCuisine":["Mexican","Seafood"],
   "openingHoursSpecification":[{"@type":"OpeningHoursSpecification","dayOfWeek":["https://schema.org/Monday","https://schema.org/Tuesday"],"opens":"11:00","closes":"20:00"}],
   "aggregateRating":{"@type":"AggregateRating","ratingValue":"4.6","reviewCount":"212"}}
  </script>
  <script type="application/ld+json">{"@graph":[{"@type":"WebSite","name":"x"},{"@type":"TouristAttraction","name":"Emerald Bay Lookout","description":"Short walk to a viewpoint."}]}</script>
  <script type="application/ld+json">{ this is not json </script>
  <script>window.dataLayer = []; console.log("SHOULD NOT APPEAR");</script>
  <style>.x{color:red} STYLE_TEXT</style>
</head><body>
  <header><a href="/">Home</a> <a href="/about">About</a></header>
  <nav>Home About Contact NAVTEXT</nav>
  <div role="navigation">Skip links SKIPTEXT</div>
  <main>
    <h1>Marina Taco Truck</h1>
    <p>Baja-style fish tacos &amp; agua fresca, right on the marina.</p>
    <p>Order at the window.</p>
    <p>Order at the window.</p>
    <img src="/img/cover.jpg" alt="Tacos on a paper boat">
    <img src="/img/deck.jpg" alt="Deck seating by the water" width="800">
    ${filler}
  </main>
  <aside>Promo ASIDETEXT</aside>
  <footer>© Marina Taco Truck FOOTERTEXT <address>700 N Lake Blvd, Tahoe City, CA 96145</address> <a href="tel:+15305550199">Call</a> <a href="https://www.google.com/maps/place/Marina+Taco+Truck/@39.1,-120.1">Directions</a></footer>
</body></html>`;

describe('unfurl digest', () => {
  const base = 'https://tacos.example/menu';
  const unfurled = parseUnfurl(html, base);
  const digest = buildDigest(html, unfurled);

  it('keeps the main content and drops chrome, scripts and styles', () => {
    expect(digest.text).toContain('Baja-style fish tacos & agua fresca');
    expect(digest.text).toContain('Order at the window.');
    for (const bad of [
      'SHOULD NOT APPEAR',
      'STYLE_TEXT',
      'NAVTEXT',
      'SKIPTEXT',
      'ASIDETEXT',
      'FOOTERTEXT',
    ])
      expect(digest.text).not.toContain(bad);
    expect(digest.text.split('Order at the window.').length).toBe(2);
  });

  it('renders business data from JSON-LD and ignores broken blocks', () => {
    expect(digest.jsonLd).toHaveLength(2);
    const r = digest.jsonLd[0];
    expect(r).toContain('JSON-LD restaurant: name=Marina Taco Truck');
    expect(r).toContain('address=700 N Lake Blvd, Tahoe City, CA 96145');
    expect(r).toContain('phone=+1 530-555-0199');
    expect(r).toContain('hours=Mon/Tue 11:00–20:00');
    expect(r).toContain('priceRange=$$');
    expect(r).toContain('cuisine=Mexican, Seafood');
    expect(r).toContain('rating=4.6 (212 reviews)');
    expect(digest.jsonLd[1]).toContain(
      'touristattraction: name=Emerald Bay Lookout',
    );
  });

  it('pairs candidate images with alt text', () => {
    expect(digest.candidates[0]).toEqual({
      url: 'https://tacos.example/img/cover.jpg',
      alt: 'Tacos on a paper boat',
    });
    expect(
      digest.candidates.find((c) => c.url.endsWith('/deck.jpg'))?.alt,
    ).toBe('Deck seating by the water');
    expect(digest.candidates.length).toBeLessThanOrEqual(8);
  });

  it('stays inside the character budget with a truncation marker', () => {
    const out = renderDigest(unfurled, digest);
    expect(out.length).toBeLessThanOrEqual(DIGEST_MAX_CHARS + 50);
    expect(out).toContain('…[truncated]');
    expect(out).toContain('<page_content>');
    expect(out).toContain('<structured_data>');
    expect(out).toContain(
      '[1] https://tacos.example/img/cover.jpg — Tacos on a paper boat',
    );
    expect(isThin(digest)).toBe(false);
  });

  it('collects address signals from the footer, links and structured data', () => {
    const c = digest.contact.join('\n');
    expect(c).toContain('700 N Lake Blvd, Tahoe City, CA 96145');
    expect(c).toContain('phone: +15305550199');
    expect(c).toContain('maps place: Marina Taco Truck');
    expect(digest.text).not.toContain('FOOTERTEXT');
    expect(renderDigest(unfurled, digest)).toContain('<contact>');
    expect(bestAddress(digest)).toBe('700 N Lake Blvd, Tahoe City, CA 96145');
  });

  it('finds a footer-only address and an event location without business JSON-LD', () => {
    const page = `<html><head><title>Fun Run</title></head><body><main><h1>Lakeside Fun Run</h1><p>${'A family 5k along the shore with a kids dash. '.repeat(6)}</p></main>
      <footer>Lakeside Rec District · 400 Fairway Dr, Tahoe City, CA 96145 · hello@lakeside.example</footer></body></html>`;
    const d = buildDigest(page, parseUnfurl(page, 'https://run.example/'));
    expect(d.jsonLd).toEqual([]);
    expect(bestAddress(d)).toBe('400 Fairway Dr, Tahoe City, CA 96145');

    const ev = `<html><head><script type="application/ld+json">{"@type":"Event","name":"Night Hike","location":{"@type":"Place","name":"Visitor Center","address":{"@type":"PostalAddress","streetAddress":"1 Park Rd","addressLocality":"Truckee","addressRegion":"CA"},"geo":{"latitude":39.3,"longitude":-120.2}}}</script></head><body><main><p>${'Guided hike under the stars. '.repeat(10)}</p></main></body></html>`;
    const de = buildDigest(ev, parseUnfurl(ev, 'https://park.example/hike'));
    expect(de.jsonLd[0]).toContain('event: name=Night Hike');
    expect(de.jsonLd[0]).toContain('address=1 Park Rd, Truckee, CA');
    expect(de.jsonLd[0]).toContain('geo=39.3,-120.2');
    expect(bestAddress(de)).toBe('1 Park Rd, Truckee, CA');
  });

  it('treats an empty page as thin', () => {
    const empty = parseUnfurl(
      '<html><body><p>hi</p></body></html>',
      'https://x.example/',
    );
    const d = buildDigest('<html><body><p>hi</p></body></html>', empty);
    expect(isThin(d)).toBe(true);
    expect(renderDigest(empty, d)).toContain('(none)');
  });
});
