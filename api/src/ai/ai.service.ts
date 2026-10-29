import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { UnfurlCache } from '../entities';
import {
  bestAddress,
  bestMenuLink,
  Digest,
  isThin,
  renderDigest,
} from '../unfurl/unfurl.digest';
import type { Unfurled } from '../unfurl/unfurl.parser';
import { AI_CLIENT } from './ai.client';
import type { AiClient } from './ai.client';
import { SYSTEM_PROMPT } from './ai.prompt';
import { AiPreview, AiStatus, COST_LEVELS } from './ai.schema';

export interface AiConfig {
  enabled: boolean;
  model: string;
  dailyCap: number;
}

export interface EnrichResult {
  ai: AiPreview | null;
  aiStatus: AiStatus;
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60_000;
const CALL_TIMEOUT_MS = 10_500;
export const DEFAULT_MODEL = 'claude-haiku-5-5';

@Injectable()
export class AiService {
  private readonly log = new Logger(AiService.name);
  private readonly daily = new Map<string, { day: string; n: number }>();
  private warned = false;

  constructor(
    @InjectRepository(UnfurlCache)
    private readonly cache: Repository<UnfurlCache>,
    @Inject(AI_CLIENT) private readonly client: AiClient,
  ) {}

  /** Read per request so tests and operators can flip env without a restart. */
  config(): AiConfig {
    const hasKey =
      !!process.env.ANTHROPIC_API_KEY || process.env.AI_FAKE === '1';
    return {
      enabled: hasKey && process.env.AI_ENRICH !== '0',
      model: process.env.AI_MODEL || DEFAULT_MODEL,
      dailyCap: Math.max(0, Number(process.env.AI_DAILY_CAP ?? 150) || 0),
    };
  }

  async enrich(
    url: string,
    unfurled: Unfurled,
    digest: Digest,
    tripId: string,
    fresh = false,
  ): Promise<EnrichResult> {
    const cfg = this.config();
    if (!cfg.enabled) return { ai: null, aiStatus: 'off' };

    const hash = createHash('sha256').update(cacheKey(url)).digest('hex');
    const hit = fresh
      ? null
      : await this.cache.findOne({ where: { urlHash: hash } });
    if (hit) {
      if (Date.now() - hit.createdAt < CACHE_TTL_MS) {
        try {
          return { ai: JSON.parse(hit.json) as AiPreview, aiStatus: 'cached' };
        } catch {
          /* fall through and refresh */
        }
      }
      await this.cache.delete({ urlHash: hash });
    }

    if (isThin(digest)) {
      this.log.debug(`Skipping AI for ${url}: page too thin`);
      return { ai: null, aiStatus: 'error' };
    }

    if (!this.underCap(tripId, cfg.dailyCap))
      return { ai: null, aiStatus: 'capped' };

    try {
      const user = renderDigest(unfurled, digest);
      const res = await Promise.race([
        this.client.summarize({
          system: SYSTEM_PROMPT,
          user,
          model: cfg.model,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('AI timeout')),
            CALL_TIMEOUT_MS,
          ).unref(),
        ),
      ]);
      if (res.usage)
        this.log.debug(
          `AI tokens in=${res.usage.input} out=${res.usage.output} (${cfg.model})`,
        );
      if (
        !res.parsed ||
        res.stopReason === 'refusal' ||
        res.stopReason === 'max_tokens'
      ) {
        this.warnOnce(`AI returned no usable result (${res.stopReason})`);
        return { ai: null, aiStatus: 'error' };
      }
      const ai = sanitize(
        res.parsed,
        digest.candidates.map((c) => c.url),
        digest.menuLinks.map((l) => l.url),
      );
      if (!ai.address) ai.address = bestAddress(digest);
      if (!ai.menuUrl && ai.kind === 'food')
        ai.menuUrl = bestMenuLink(digest, url);
      await this.cache.save(
        this.cache.create({
          urlHash: hash,
          url,
          model: cfg.model,
          json: JSON.stringify(ai),
        }),
      );
      return { ai, aiStatus: 'ok' };
    } catch (e) {
      this.warnOnce(`AI summary failed: ${(e as Error).message}`);
      return { ai: null, aiStatus: 'error' };
    }
  }

  private underCap(tripId: string, cap: number): boolean {
    const day = new Date().toISOString().slice(0, 10);
    const cur = this.daily.get(tripId);
    if (!cur || cur.day !== day) {
      this.daily.set(tripId, { day, n: 1 });
      return cap > 0;
    }
    if (cur.n >= cap) return false;
    cur.n += 1;
    return true;
  }

  private warnOnce(msg: string) {
    if (this.warned) this.log.debug(msg);
    else {
      this.warned = true;
      this.log.warn(msg);
    }
  }
}

/** Same page, different tracking params: one cache entry. */
export function cacheKey(url: string): string {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.toLowerCase();
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref$|_ga)/i.test(k))
        u.searchParams.delete(k);
    }
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

/** Never trust the model's shape blindly: clamp to the idea form's limits. */
export function sanitize(
  p: AiPreview,
  candidates: string[],
  menuCandidates: string[] = [],
): AiPreview {
  const s = (v: unknown, max: number) =>
    typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  const seen = new Set<string>();
  const details = (Array.isArray(p.details) ? p.details : [])
    .map((d) => ({ label: s(d?.label, 40), value: s(d?.value, 300) }))
    .filter(
      (d) =>
        d.label &&
        d.value &&
        !seen.has(d.label.toLowerCase()) &&
        seen.add(d.label.toLowerCase()),
    )
    .slice(0, 6);
  const cover = s(p.coverImage, 1000);
  const menu = s(p.menuUrl, 500);
  return {
    title: s(p.title, 120),
    kind: p.kind === 'food' || p.kind === 'activity' ? p.kind : 'other',
    summary: s(p.summary, 2000),
    address: s(p.address, 300),
    phone: s(p.phone, 60),
    hours: s(p.hours, 300),
    priceLevel: (COST_LEVELS as readonly string[]).includes(p.priceLevel)
      ? p.priceLevel
      : '',
    details,
    goodFor: s(p.goodFor, 120),
    bookingNote: s(p.bookingNote, 300),
    menuUrl: menuCandidates.includes(menu) ? menu : '',
    coverImage: candidates.includes(cover) ? cover : '',
    confidence: Math.min(1, Math.max(0, Number(p.confidence) || 0)),
  };
}
