/** Date helpers. All trip dates are plain YYYY-MM-DD strings with no timezone. */

export function parseIso(iso: string): Date {
  return new Date(iso + 'T00:00:00');
}

export function todayIso(): string {
  const d = new Date();
  return [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join('-');
}

export function addDays(iso: string, n: number): string {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join('-');
}

export function dayName(iso: string): string {
  return parseIso(iso).toLocaleDateString(undefined, { weekday: 'long' });
}

export function shortDate(iso: string): string {
  return parseIso(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function longDate(iso: string): string {
  return parseIso(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function dateRangeLabel(start: string, end: string): string {
  const s = parseIso(start);
  const e = parseIso(end);
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  const left = s.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const right = e.toLocaleDateString(undefined, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
  return `${left} – ${right}, ${e.getFullYear()}`;
}

export function daysUntil(iso: string): number {
  const ms = parseIso(iso).getTime() - parseIso(todayIso()).getTime();
  return Math.round(ms / 86_400_000);
}

export function nights(start: string, end: string): number {
  return Math.max(0, Math.round((parseIso(end).getTime() - parseIso(start).getTime()) / 86_400_000));
}

export function time12(hhmm: string): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return m ? `${hour}:${pad(m)}${suffix}` : `${hour}${suffix}`;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
