import { BadRequestException, Injectable } from '@nestjs/common';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { parseUnfurl, Unfurled } from './unfurl.parser';
import { bestAddress, buildDigest, Digest } from './unfurl.digest';
import { AiService } from '../ai/ai.service';
import type { AiPreview, AiStatus } from '../ai/ai.schema';

export type UnfurlResponse = Unfurled & {
  ai: AiPreview | null;
  aiStatus: AiStatus;
};

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 8_000;
// Sent as a social-sharing bot: most sites serve their Open Graph tags to these.
const USER_AGENT =
  'Mozilla/5.0 (compatible; LetsGoBot/1.0; +https://github.com/Leshko/letsgo-trip-planner) facebookexternalhit/1.1';

@Injectable()
export class UnfurlService {
  private readonly cache = new Map<
    string,
    { at: number; value: Unfurled; digest: Digest }
  >();

  constructor(private readonly ai: AiService) {}

  /** `fresh` re-reads the page and asks the AI again, ignoring both caches (the edit form's re-analyze). */
  async unfurl(
    raw: string,
    tripId = '',
    fresh = false,
  ): Promise<UnfurlResponse> {
    const url = normalize(raw);
    let hit = this.cache.get(url);
    if (fresh || !hit || Date.now() - hit.at >= 10 * 60_000) {
      await assertPublicHost(url);
      const html = await this.fetchHtml(url);
      const value = parseUnfurl(html.body, html.finalUrl);
      const digest = buildDigest(html.body, value);
      value.address = bestAddress(digest);
      hit = { at: Date.now(), value, digest };
      this.cache.set(url, hit);
      if (this.cache.size > 500)
        this.cache.delete(this.cache.keys().next().value as string);
    }
    // The basic preview never waits on the AI's failure modes; enrich() always resolves.
    const { ai, aiStatus } = await this.ai.enrich(
      url,
      hit.value,
      hit.digest,
      tripId,
      fresh,
    );
    return { ...hit.value, ai, aiStatus };
  }

  private async fetchHtml(
    url: string,
  ): Promise<{ body: string; finalUrl: string }> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: ctl.signal,
        redirect: 'follow',
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'accept-language': 'en',
        },
      });
      if (!res.ok)
        throw new BadRequestException(`That page answered ${res.status}`);
      // Redirects can land on a private host; check again where we ended up.
      if (res.url && res.url !== url) await assertPublicHost(res.url);
      const type = res.headers.get('content-type') ?? '';
      if (!/html|xml/i.test(type))
        throw new BadRequestException("That link isn't a web page");
      const body = await readLimited(res, MAX_BYTES);
      return { body, finalUrl: res.url || url };
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      const name = (e as { name?: string }).name;
      throw new BadRequestException(
        name === 'AbortError'
          ? 'That page took too long to answer'
          : "Couldn't reach that page",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

function normalize(raw: string): string {
  let s = (raw ?? '').trim();
  if (!s) throw new BadRequestException('Paste a link first');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new BadRequestException("That doesn't look like a link");
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    throw new BadRequestException('Only http(s) links are supported');
  u.hash = '';
  return u.toString();
}

/** Refuse anything that resolves to a private or local address (SSRF guard). */
async function assertPublicHost(url: string): Promise<void> {
  // Dev/test escape hatch so a local fixture page can be unfurled. Never set in production.
  if (process.env.UNFURL_ALLOW_PRIVATE === '1') return;
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  )
    throw new BadRequestException('That address is not reachable');
  const addrs: string[] = isIP(host)
    ? [host]
    : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new BadRequestException("Couldn't find that site");
  for (const a of addrs)
    if (isPrivate(a))
      throw new BadRequestException('That address is not reachable');
}

export function isPrivate(ip: string): boolean {
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    if (
      v === '::1' ||
      v === '::' ||
      v.startsWith('fe80:') ||
      v.startsWith('fc') ||
      v.startsWith('fd')
    )
      return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    return mapped ? isPrivate(mapped[1]) : false;
  }
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  return (
    p[0] === 10 ||
    p[0] === 127 ||
    p[0] === 0 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
  );
}

async function readLimited(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
    if (total >= max) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}
