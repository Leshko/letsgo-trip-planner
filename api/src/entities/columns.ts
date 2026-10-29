import { ValueTransformer } from 'typeorm';

/**
 * Postgres returns BIGINT as a string so it never loses precision; epoch
 * milliseconds fit comfortably in a JS number, so convert back on read.
 */
export const epochMs: ValueTransformer = {
  to: (v: number | null | undefined) => v,
  from: (v: string | number | null) =>
    v === null || v === undefined ? v : Number(v),
};
