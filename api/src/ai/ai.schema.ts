import { z } from 'zod';

/** Keep this constraint-free: the SDK strips min/max and would fail parsing on them. Clamp server-side. */
export const AiPreviewSchema = z.object({
  title: z
    .string()
    .describe('Short name of the place or activity, as a person would say it'),
  kind: z
    .enum(['activity', 'food', 'other'])
    .describe(
      'food for places you mainly go to eat or drink; activity for things to do or see',
    ),
  summary: z
    .string()
    .describe(
      '1-2 plain sentences for a family deciding whether to go. No marketing language.',
    ),
  address: z.string().describe('Street address if on the page, else empty'),
  phone: z.string(),
  hours: z.string().describe('Opening hours in one short line, else empty'),
  priceLevel: z.enum(['', 'free', '$', '$$', '$$$']),
  details: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .describe(
      'Up to 6 facts a family would want. Prefer labels: Hours, Price, Phone, Booking, Parking, Kids, Dress code, Distance',
    ),
  goodFor: z
    .string()
    .describe(
      'Who or what this suits, e.g. "kids 5+, rainy days"; empty if unclear',
    ),
  bookingNote: z
    .string()
    .describe('Whether booking/tickets are needed and how; empty if unknown'),
  coverImage: z
    .string()
    .describe(
      'Exactly one of the candidate image URLs that best shows the place, else empty',
    ),
  confidence: z
    .number()
    .describe('0 to 1: how well the page supports these answers'),
});

export type AiPreview = z.infer<typeof AiPreviewSchema>;
export type AiStatus = 'ok' | 'off' | 'cached' | 'capped' | 'error';
export const COST_LEVELS = ['', 'free', '$', '$$', '$$$'] as const;
