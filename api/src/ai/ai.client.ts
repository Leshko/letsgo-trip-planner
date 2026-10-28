import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
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

/** Pluggable so tests and dev never touch the network. */
export interface AiClient {
  summarize(input: SummarizeInput): Promise<SummarizeResult>;
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
}

/** Deterministic stand-in for development and browser tests. Enabled with AI_FAKE=1. */
@Injectable()
export class FakeAiClient implements AiClient {
  private readonly log = new Logger(FakeAiClient.name);

  constructor() {
    this.log.warn(
      'AI_FAKE=1: using the fake AI client. Never run this in production.',
    );
  }

  summarize(input: SummarizeInput): Promise<SummarizeResult> {
    const u = input.user;
    const title = /Open Graph: title=([^|]+)\|/.exec(u)?.[1]?.trim() ?? '';
    const text =
      /<page_content>\n([\s\S]*?)\n<\/page_content>/.exec(u)?.[1] ?? '';
    const ld =
      /<structured_data>\n([\s\S]*?)\n<\/structured_data>/.exec(u)?.[1] ?? '';
    const img = /\[1\] (\S+)/.exec(u)?.[1] ?? '';
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
        coverImage: img,
        confidence: 0.9,
      },
      stopReason: 'end_turn',
    });
  }
}
