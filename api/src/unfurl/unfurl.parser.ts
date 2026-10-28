/**
 * Pulls the bits a share-sheet shows out of an HTML page: title, description,
 * site name and candidate images. Open Graph and Twitter cards first, then the
 * document's own <title>/<img>s as a fallback. Regex-based on purpose: the
 * input is untrusted and we only need the head-level metadata.
 */
export interface Unfurled {
  url: string;
  title: string;
  description: string;
  siteName: string;
  image: string;
  images: string[];
  icon: string;
}

const META_RE = /<meta\b[^>]*>/gi;
const ATTR_RE = /([a-zA-Z_:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(ATTR_RE))
    out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCodePoint(parseInt(n, 16)),
    );
}

export function absolute(src: string, base: string): string | null {
  try {
    const u = new URL(src.trim(), base);
    return u.protocol === 'http:' || u.protocol === 'https:'
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function parseUnfurl(html: string, baseUrl: string): Unfurled {
  const head = html.slice(0, 400_000);
  const meta: Record<string, string[]> = {};
  for (const tag of head.match(META_RE) ?? []) {
    const a = attrs(tag);
    const key = (
      a['property'] ??
      a['name'] ??
      a['itemprop'] ??
      ''
    ).toLowerCase();
    const content = a['content'];
    if (!key || content === undefined) continue;
    (meta[key] ??= []).push(content);
  }
  const first = (...keys: string[]) => {
    for (const k of keys) {
      const v = meta[k]?.find((x) => clean(x));
      if (v) return clean(v);
    }
    return '';
  };

  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? '';
  const title =
    first('og:title', 'twitter:title') || clean(decodeEntities(titleTag));
  const description = first(
    'og:description',
    'twitter:description',
    'description',
  );
  const siteName = first('og:site_name', 'application-name') || hostOf(baseUrl);

  const images: string[] = [];
  const push = (src: string | undefined) => {
    if (!src) return;
    const abs = absolute(src, baseUrl);
    if (abs && !images.includes(abs)) images.push(abs);
  };
  for (const k of [
    'og:image:secure_url',
    'og:image',
    'og:image:url',
    'twitter:image',
    'twitter:image:src',
    'image',
  ]) {
    for (const v of meta[k] ?? []) push(v);
  }
  // Fallback: real <img>s from the body, skipping obvious icons and tracking pixels.
  if (images.length < 3) {
    for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
      const a = attrs(tag);
      const src = a['data-src'] ?? a['src'];
      if (!src || /^data:/i.test(src)) continue;
      if (
        /sprite|icon|logo|pixel|spacer|blank|1x1|tracking|avatar/i.test(
          src + ' ' + (a['class'] ?? ''),
        )
      )
        continue;
      const w = Number(a['width']) || 0;
      const h = Number(a['height']) || 0;
      if ((w && w < 120) || (h && h < 120)) continue;
      push(src);
      if (images.length >= 8) break;
    }
  }

  let icon = '';
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const a = attrs(tag);
    if (
      /(^|\s)(apple-touch-icon|icon|shortcut icon)(\s|$)/i.test(a['rel'] ?? '')
    ) {
      icon = absolute(a['href'] ?? '', baseUrl) ?? '';
      if (icon) break;
    }
  }

  return {
    url: baseUrl,
    title,
    description,
    siteName,
    image: images[0] ?? '',
    images: images.slice(0, 8),
    icon,
  };
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
