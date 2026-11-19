import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ZodType } from 'zod';
import { AiPreview, AiPreviewSchema } from './ai.schema';

export interface SummarizeInput {
  system: string;
  user: string;
  model: string;
}

export interface SummarizeResult {
  parsed: AiPreview | null;
  stopReason: string;
  usage?: { input: number; output: number };
}

/** A question with a fixed answer shape, optionally about one image. */
export interface StructuredInput<T> {
  /** What this is for; the fake client answers by task. */
  task: string;
  system: string;
  user: string;
  model: string;
  schema: ZodType<T>;
  image?: {
    base64: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  };
  maxTokens?: number;
}

export interface StructuredResult<T> {
  parsed: T | null;
  stopReason: string;
  usage?: { input: number; output: number };
}

/** Pluggable so tests and dev never touch the network. */
export interface AiClient {
  summarize(input: SummarizeInput): Promise<SummarizeResult>;
  structured?<T>(input: StructuredInput<T>): Promise<StructuredResult<T>>;
}
export const AI_CLIENT = Symbol('AI_CLIENT');

@Injectable()
export class AnthropicAiClient implements AiClient {
  private client: Anthropic | null = null;

  async summarize(input: SummarizeInput): Promise<SummarizeResult> {
    // Built lazily so a missing key only matters when a summary is actually requested.
    this.client ??= new Anthropic({ timeout: 10_000, maxRetries: 0 });
    const res = await this.client.messages.parse({
      model: input.model,
      max_tokens: 1024,
      system: input.system,
      messages: [{ role: 'user', content: input.user }],
      output_config: {
        format: zodOutputFormat(AiPreviewSchema),
        effort: 'low',
      },
    });
    return {
      parsed: res.parsed_output ?? null,
      stopReason: res.stop_reason ?? 'unknown',
      usage: { input: res.usage.input_tokens, output: res.usage.output_tokens },
    };
  }

  async structured<T>(input: StructuredInput<T>): Promise<StructuredResult<T>> {
    this.client ??= new Anthropic({ timeout: 10_000, maxRetries: 0 });
    const res = await this.client.messages.parse({
      model: input.model,
      max_tokens: input.maxTokens ?? 1024,
      system: input.system,
      messages: [
        {
          role: 'user',
          content: input.image
            ? [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: input.image.mediaType,
                    data: input.image.base64,
                  },
                },
                { type: 'text', text: input.user },
              ]
            : input.user,
        },
      ],
      output_config: {
        format: zodOutputFormat(input.schema),
        effort: 'low',
      },
    });
    return {
      parsed: res.parsed_output ?? null,
      stopReason: res.stop_reason ?? 'unknown',
      usage: { input: res.usage.input_tokens, output: res.usage.output_tokens },
    };
  }
}

/**
 * What the fake client answers for each structured task. Features register
 * theirs here so the fake stays in step with the real prompts.
 */
export const FAKE_ANSWERS = new Map<
  string,
  (input: StructuredInput<unknown>) => unknown
>();

/** Deterministic stand-in for development and browser tests. Enabled with AI_FAKE=1. */
@Injectable()
export class FakeAiClient implements AiClient {
  private readonly log = new Logger(FakeAiClient.name);

  constructor() {
    this.log.warn(
      'AI_FAKE=1: using the fake AI client. Never run this in production.',
    );
  }

  /** Canned answers by task; the selfie game's live in selfies/selfie.ai.ts. */
  structured<T>(input: StructuredInput<T>): Promise<StructuredResult<T>> {
    const fake = FAKE_ANSWERS.get(input.task);
    if (!fake) return Promise.resolve({ parsed: null, stopReason: 'refusal' });
    return Promise.resolve({
      parsed: fake(input) as T,
      stopReason: 'end_turn',
    });
  }

  summarize(input: SummarizeInput): Promise<SummarizeResult> {
    const u = input.user;
    const title = /Open Graph: title=([^|]+)\|/.exec(u)?.[1]?.trim() ?? '';
    const text =
      /<page_content>\n([\s\S]*?)\n<\/page_content>/.exec(u)?.[1] ?? '';
    const ld =
      /<structured_data>\n([\s\S]*?)\n<\/structured_data>/.exec(u)?.[1] ?? '';
    const img = /\[1\] (\S+)/.exec(u)?.[1] ?? '';
    const menu = /<menu_links>\n\[1\] (\S+)/.exec(u)?.[1] ?? '';
    const grab = (key: string) =>
      new RegExp(`${key}=([^;\\n]+)`).exec(ld)?.[1]?.trim() ?? '';
    const isFood = /menu|restaurant|cuisine|dinner|lunch|tacos|brunch/i.test(u);
    const details: { label: string; value: string }[] = [];
    if (grab('hours')) details.push({ label: 'Hours', value: grab('hours') });
    if (grab('phone')) details.push({ label: 'Phone', value: grab('phone') });
    const price = grab('priceRange');
    return Promise.resolve({
      parsed: {
        title: title === '(none)' ? '' : title,
        kind: isFood ? 'food' : 'activity',
        summary:
          (
            text.split('\n').find((l) => l.length >= 40) ??
            text.split('\n')[0] ??
            ''
          ).slice(0, 160) || 'A spot the family might like.',
        address: grab('address'),
        phone: grab('phone'),
        hours: grab('hours'),
        priceLevel: ['free', '$', '$$', '$$$'].includes(price)
          ? (price as AiPreview['priceLevel'])
          : '',
        details,
        goodFor: 'kids 5+, rainy days',
        bookingNote: '',
        menuUrl: menu,
        coverImage: img,
        confidence: 0.9,
      },
      stopReason: 'end_turn',
    });
  }
}
