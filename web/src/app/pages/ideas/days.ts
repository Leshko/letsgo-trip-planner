import { addDays } from '../../core/format';

/** Inclusive list of trip days. */
export function dateRangeDays(start: string, end: string): string[] {
  const out: string[] = [];
  let d = start;
  while (d <= end && out.length < 60) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}
