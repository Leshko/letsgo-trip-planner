import { absolute, decodeEntities, Unfurled } from './unfurl.parser';

/** What the summarizer gets to read: a compact, text-only view of the page. */
export interface Digest {
  text: string;
  jsonLd: string[];
  candidates: { url: string; alt: string }[];
}

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
  return {
    jsonLd: extractJsonLd(noComments),
    text: extractText(noComments),
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
  const fixed = `${head}\n<structured_data>\n${ld}\n</structured_data>\n<candidate_images>\n${imgs}\n</candidate_images>\n`;
  const room = Math.max(1_000, DIGEST_MAX_CHARS - fixed.length - 40);
  let text = digest.text;
  if (text.length > room) text = text.slice(0, room) + '\n…[truncated]';
  return `${fixed}<page_content>\n${text}\n</page_content>`;
}

export function isThin(digest: Digest): boolean {
  return digest.text.length < 200 && digest.jsonLd.length === 0;
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
  if (!types.some((t) => PLACE_TYPES.has(t))) return '';
  const rating = o['aggregateRating'] as Obj | undefined;
  const parts: [string, string][] = [
    ['name', str(o['name'])],
    ['description', str(o['description']).slice(0, 300)],
    ['address', addressOf(o['address'])],
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
