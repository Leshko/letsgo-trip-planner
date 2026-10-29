import { absolute, decodeEntities, Unfurled } from './unfurl.parser';

/** What the summarizer gets to read: a compact, text-only view of the page. */
export interface Digest {
  text: string;
  jsonLd: string[];
  /** Footer, contact and address signals: the places a street address usually hides. */
  contact: string[];
  /** Links that look like they lead to a menu (places to eat). */
  menuLinks: { url: string; text: string }[];
  candidates: { url: string; alt: string }[];
}

const CONTACT_MAX_CHARS = 1_500;

export const DIGEST_MAX_CHARS = 12_000;
const JSONLD_MAX_CHARS = 3_000;
const JSONLD_LINE_MAX = 600;

const PLACE_TYPES = new Set([
  'restaurant',
  'foodestablishment',
  'cafeorcoffeeshop',
  'bar',
  'bakery',
  'localbusiness',
  'touristattraction',
  'place',
  'event',
  'hotel',
  'lodgingbusiness',
  'museum',
  'park',
  'amusementpark',
  'zoo',
  'aquarium',
  'organization',
  'product',
  'sportsactivitylocation',
  'entertainmentbusiness',
]);

export function buildDigest(html: string, unfurled: Unfurled): Digest {
  const noComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const text = extractText(noComments);
  return {
    jsonLd: extractJsonLd(noComments),
    text,
    contact: extractContact(noComments, text, unfurled.url),
    menuLinks: extractMenuLinks(noComments, unfurled.url),
    candidates: candidates(noComments, unfurled),
  };
}

/** The user message body sent to the model; the page is data, not instructions. */
export function renderDigest(unfurled: Unfurled, digest: Digest): string {
  const head = [
    `URL: ${unfurled.url}`,
    `Open Graph: title=${unfurled.title || '(none)'} | description=${unfurled.description || '(none)'} | site=${unfurled.siteName || '(none)'}`,
  ].join('\n');
  let ld = digest.jsonLd.join('\n');
  if (ld.length > JSONLD_MAX_CHARS)
    ld = ld.slice(0, JSONLD_MAX_CHARS) + ' …[truncated]';
  const imgs = digest.candidates
    .map((c, i) => `[${i + 1}] ${c.url} — ${c.alt || '(no alt)'}`)
    .join('\n');
  let contact = digest.contact.join('\n');
  if (contact.length > CONTACT_MAX_CHARS)
    contact = contact.slice(0, CONTACT_MAX_CHARS) + ' …[truncated]';
  const menus = digest.menuLinks
    .map((l, i) => `[${i + 1}] ${l.url}${l.text ? ' — ' + l.text : ''}`)
    .join('\n');
  const fixed = `${head}\n<structured_data>\n${ld}\n</structured_data>\n<contact>\n${contact}\n</contact>\n<menu_links>\n${menus}\n</menu_links>\n<candidate_images>\n${imgs}\n</candidate_images>\n`;
  const room = Math.max(1_000, DIGEST_MAX_CHARS - fixed.length - 40);
  let text = digest.text;
  if (text.length > room) text = text.slice(0, room) + '\n…[truncated]';
  return `${fixed}<page_content>\n${text}\n</page_content>`;
}

export function isThin(digest: Digest): boolean {
  return (
    digest.text.length < 200 &&
    digest.jsonLd.length === 0 &&
    digest.contact.length === 0
  );
}

/** The most trustworthy address on the page, for when the model leaves it blank or the AI is off. */
export function bestAddress(digest: Digest): string {
  const pick = (lines: string[], prefix: string) => {
    for (const l of lines) {
      if (l.startsWith(prefix)) return l.slice(prefix.length).trim();
    }
    return '';
  };
  for (const l of digest.jsonLd) {
    const m = /address=([^;]+)/.exec(l);
    if (m && m[1].trim().length > 6) return m[1].trim().slice(0, 300);
  }
  return (
    pick(digest.contact, 'meta address:') ||
    pick(digest.contact, 'possible address:') ||
    pick(digest.contact, 'maps place:')
  ).slice(0, 300);
}

// ---- JSON-LD ----

function extractJsonLd(html: string): string[] {
  const out: string[] = [];
  const re =
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    const raw = m[1]
      .replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '')
      .replace(/^\uFEFF/, '')
      .trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    for (const node of flatten(parsed)) {
      const line = describeNode(node);
      if (line)
        out.push(
          line.length > JSONLD_LINE_MAX
            ? line.slice(0, JSONLD_LINE_MAX) + '…'
            : line,
        );
      if (out.length >= 8) return out;
    }
  }
  return out;
}

type Obj = Record<string, unknown>;

function flatten(v: unknown): Obj[] {
  if (Array.isArray(v)) return v.flatMap(flatten);
  if (!v || typeof v !== 'object') return [];
  const o = v as Obj;
  const own: Obj[] = [o];
  if (Array.isArray(o['@graph'])) own.push(...flatten(o['@graph']));
  return own;
}

function typesOf(o: Obj): string[] {
  const t = o['@type'];
  const list = Array.isArray(t) ? t : t ? [t] : [];
  return list.map((x) =>
    String(x)
      .toLowerCase()
      .replace(/^https?:\/\/schema\.org\//, ''),
  );
}

function str(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.replace(/\s+/g, ' ').trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(str).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const o = v as Obj;
    if (typeof o['name'] === 'string') return str(o['name']);
    if (typeof o['@value'] === 'string') return str(o['@value']);
  }
  return '';
}

function geoOf(o: Obj): string {
  const g = o['geo'] as Obj | undefined;
  if (!g) return '';
  const lat = str(g['latitude']);
  const lng = str(g['longitude']);
  return lat && lng ? `${lat},${lng}` : '';
}

function addressOf(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return str(v);
  if (Array.isArray(v)) return addressOf(v[0]);
  const a = v as Obj;
  return [
    a['streetAddress'],
    a['addressLocality'],
    [a['addressRegion'], a['postalCode']].map(str).filter(Boolean).join(' '),
    a['addressCountry'],
  ]
    .map(str)
    .filter(Boolean)
    .join(', ');
}

const DAY =
  /^(https?:\/\/schema\.org\/)?(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day$/;

function hoursOf(o: Obj): string {
  const plain = str(o['openingHours']);
  if (plain) return plain;
  const spec = o['openingHoursSpecification'];
  if (!spec) return '';
  const rows = (Array.isArray(spec) ? spec : [spec]) as Obj[];
  return rows
    .map((r) => {
      const days = (
        Array.isArray(r['dayOfWeek']) ? r['dayOfWeek'] : [r['dayOfWeek']]
      )
        .map((d) => {
          const m = DAY.exec(String(d ?? ''));
          return m ? m[2].slice(0, 3) : str(d);
        })
        .filter(Boolean)
        .join('/');
      const span = [r['opens'], r['closes']].map(str).filter(Boolean).join('–');
      return days && span ? `${days} ${span}` : '';
    })
    .filter(Boolean)
    .join(', ');
}

function describeNode(o: Obj): string {
  const types = typesOf(o);
  const loc = (
    Array.isArray(o['location']) ? o['location'][0] : o['location']
  ) as Obj | undefined;
  const address =
    addressOf(o['address']) ||
    (loc ? addressOf(loc['address']) || str(loc) : '');
  if (!types.some((t) => PLACE_TYPES.has(t)) && !address) return '';
  const rating = o['aggregateRating'] as Obj | undefined;
  const parts: [string, string][] = [
    ['name', str(o['name'])],
    ['description', str(o['description']).slice(0, 300)],
    ['address', address],
    ['geo', geoOf(o) || (loc ? geoOf(loc) : '')],
    ['phone', str(o['telephone'])],
    ['hours', hoursOf(o)],
    ['priceRange', str(o['priceRange'])],
    ['cuisine', str(o['servesCuisine'])],
    [
      'rating',
      rating
        ? [
            str(rating['ratingValue']),
            rating['reviewCount']
              ? `(${str(rating['reviewCount'])} reviews)`
              : '',
          ]
            .filter(Boolean)
            .join(' ')
        : '',
    ],
    ['url', str(o['url'])],
  ];
  const body = parts
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return body ? `JSON-LD ${types.join('/')}: ${body}` : '';
}

// ---- body text ----

const DROP_WHOLE =
  /<(script|style|noscript|svg|template|iframe|canvas|select|video|audio|object|embed)\b[\s\S]*?<\/\1>/gi;
const DROP_CHROME = /<(nav|footer|header|aside|form|dialog)\b[\s\S]*?<\/\1>/gi;
const DROP_HIDDEN =
  /<([a-z][a-z0-9]*)\b[^>]*(?:aria-hidden\s*=\s*["']true["']|role\s*=\s*["'](?:navigation|banner|contentinfo)["'])[^>]*>[\s\S]*?<\/\1>/gi;

function extractText(html: string): string {
  let h = html.replace(DROP_WHOLE, ' ');
  const main = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(h);
  if (main && stripTags(main[2]).length >= 400) h = main[2];
  else {
    const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(h);
    if (body) h = body[1];
  }
  h = h.replace(DROP_CHROME, ' ').replace(DROP_HIDDEN, ' ');
  const text = stripTags(h);
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/[ \t\u00a0]+/g, ' ').trim();
    if (line.length < 3) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines.join('\n');
}

function stripTags(h: string): string {
  return decodeEntities(
    h
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(
        /<\/(p|div|li|h[1-6]|tr|section|article|blockquote|dd|dt|figcaption|td|th)>/gi,
        '\n',
      )
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n');
}

// ---- images ----

function candidates(
  html: string,
  unfurled: Unfurled,
): { url: string; alt: string }[] {
  const alts = new Map<string, string>();
  const attrRe = /([a-zA-Z_:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const a: Record<string, string> = {};
    for (const m of tag.matchAll(attrRe))
      a[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
    const src = a['data-src'] ?? a['src'];
    const abs = src ? absolute(src, unfurled.url) : null;
    if (abs && a['alt'] && !alts.has(abs))
      alts.set(abs, a['alt'].replace(/\s+/g, ' ').trim().slice(0, 120));
  }
  for (const m of html.matchAll(
    /<meta\b[^>]*property\s*=\s*["']og:image:alt["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>/gi,
  )) {
    if (unfurled.image && !alts.has(unfurled.image))
      alts.set(unfurled.image, decodeEntities(m[1]).slice(0, 120));
  }
  return unfurled.images
    .slice(0, 8)
    .map((url) => ({ url, alt: alts.get(url) ?? '' }));
}

// ---- contact / address signals ----

const CONTACT_BLOCK =
  /<(address|footer)\b[^>]*>([\s\S]*?)<\/\1>|<([a-z][a-z0-9]*)\b[^>]*(?:id|class)\s*=\s*["'][^"']*(?:contact|address|location|directions|visit|find-us|findus)[^"']*["'][^>]*>([\s\S]*?)<\/\3>/gi;
const STREET =
  /\b\d{1,6}[A-Za-z]?\s+(?:[A-Z][A-Za-z0-9.'-]*\s){0,5}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Hwy|Highway|Way|Ln|Lane|Ct|Court|Trail|Trl|Pkwy|Parkway|Pl|Place|Sq|Square|Terrace|Ter|Circle|Cir|Loop|Pier|Marina|Wharf)\b\.?(?:[^\n]{0,70}?\b[A-Z]{2}\s?\d{5}(?:-\d{4})?)?/g;

function extractContact(
  html: string,
  pageText: string,
  baseUrl: string,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (line: string) => {
    const l = line.replace(/\s+/g, ' ').trim();
    if (!l || seen.has(l.toLowerCase())) return;
    seen.add(l.toLowerCase());
    out.push(l.length > 300 ? l.slice(0, 300) + '…' : l);
  };

  // Open Graph / business meta tags
  const meta: Record<string, string> = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const prop = /(?:property|name)\s*=\s*["']([^"']+)["']/i
      .exec(tag)?.[1]
      ?.toLowerCase();
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (prop && content) meta[prop] = decodeEntities(content).trim();
  }
  const metaAddress = [
    meta['og:street-address'] ?? meta['business:contact_data:street_address'],
    meta['og:locality'] ?? meta['business:contact_data:locality'],
    [
      meta['og:region'] ?? meta['business:contact_data:region'],
      meta['og:postal-code'] ?? meta['business:contact_data:postal_code'],
    ]
      .filter(Boolean)
      .join(' '),
    meta['og:country-name'] ?? meta['business:contact_data:country_name'],
  ]
    .filter(Boolean)
    .join(', ');
  if (metaAddress) push(`meta address: ${metaAddress}`);
  else if (meta['geo.placename'])
    push(`meta address: ${meta['geo.placename']}`);
  const geo =
    meta['place:location:latitude'] && meta['place:location:longitude']
      ? `${meta['place:location:latitude']},${meta['place:location:longitude']}`
      : (meta['geo.position'] ?? meta['icbm'] ?? '');
  if (geo) push(`meta geo: ${geo.replace(/;/g, ',')}`);

  // Map and phone links anywhere on the page
  for (const m of html.matchAll(
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi,
  )) {
    const href = decodeEntities(m[1]);
    if (/^tel:/i.test(href)) push(`phone: ${href.slice(4).trim()}`);
    else if (
      /maps\.google|google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl|maps\.apple|\/maps\/place\//i.test(
        href,
      )
    ) {
      const abs = absolute(href, baseUrl) ?? href;
      let place = '';
      try {
        const u = new URL(abs);
        place =
          u.searchParams.get('q') ??
          u.searchParams.get('query') ??
          u.searchParams.get('daddr') ??
          '';
        if (!place) {
          const p = /\/maps\/place\/([^/@?]+)/.exec(u.pathname);
          if (p) place = decodeURIComponent(p[1]).replace(/\+/g, ' ');
        }
      } catch {
        /* keep the raw href */
      }
      push(
        place && !/^-?\d+\.\d+,/.test(place)
          ? `maps place: ${place}`
          : `maps link: ${abs.slice(0, 200)}`,
      );
    }
  }

  // Footer, <address>, and anything that calls itself contact/location
  for (const m of html.matchAll(CONTACT_BLOCK)) {
    const inner = m[2] ?? m[4] ?? '';
    const text = stripTags(inner.replace(DROP_WHOLE, ' '))
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 2)
      .join(' · ');
    if (text) push(text);
    if (out.join('\n').length > CONTACT_MAX_CHARS * 2) break;
  }

  // Last resort: anything that looks like a street address in the visible text
  let hits = 0;
  for (const m of (pageText + '\n' + out.join('\n')).matchAll(STREET)) {
    push(`possible address: ${m[0]}`);
    if (++hits >= 3) break;
  }
  return out;
}

// ---- menu links ----

const MENU_WORD =
  /\b(menus?|carte|bill of fare|food & drink|food and drink|drinks? menu|wine list|order online)\b/i;

function extractMenuLinks(
  html: string,
  baseUrl: string,
): { url: string; text: string }[] {
  const out: { url: string; text: string }[] = [];
  const seen = new Set<string>();
  const page = baseUrl.replace(/[#?].*$/, '').replace(/\/$/, '');
  for (const m of html.matchAll(
    /<a\b([^>]*)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi,
  )) {
    const href = decodeEntities(m[2]).trim();
    if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
    const attrs = `${m[1]} ${m[3]}`;
    const text = stripTags(m[4]).replace(/\s+/g, ' ').trim().slice(0, 80);
    const aria =
      /(?:aria-label|title)\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? '';
    const label = text || decodeEntities(aria).trim().slice(0, 80);
    const byText = MENU_WORD.test(label);
    const byHref =
      /menu|carte|order-online/i.test(href) ||
      (/\.pdf(\?|$)/i.test(href) && /menu/i.test(label));
    if (!byText && !byHref) continue;
    // A link that only opens the site's navigation drawer is not a menu.
    if (/\b(nav|hamburger|toggle|drawer|burger)\b/i.test(attrs) && !byHref)
      continue;
    const abs = absolute(href, baseUrl);
    if (!abs || !/^https?:/i.test(abs)) continue;
    const key = abs.replace(/[#]$/, '');
    if (seen.has(key) || key.replace(/\/$/, '') === page) continue;
    seen.add(key);
    out.push({ url: abs.slice(0, 500), text: label });
    if (out.length >= 8) break;
  }
  // Links that say "menu" outrank "food & drink", which outrank ones that only have it in the path.
  const rank = (l: { url: string; text: string }) =>
    /\bmenus?\b/i.test(l.text) ? 2 : MENU_WORD.test(l.text) ? 1 : 0;
  return out.sort((a, b) => rank(b) - rank(a));
}

/** The menu link to use when the model leaves it blank or the AI is off. */
export function bestMenuLink(digest: Digest, pageUrl = ''): string {
  if (digest.menuLinks.length) return digest.menuLinks[0].url;
  return /\/menu(s)?(\.|\/|\?|$)/i.test(pageUrl) ? pageUrl : '';
}
