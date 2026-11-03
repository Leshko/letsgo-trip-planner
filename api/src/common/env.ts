/**
 * Unraid passes every field of a container template to the container, empty
 * ones included (VAPID_SUBJECT="" etc.). An empty setting means "not set", so
 * drop them before anything reads the environment.
 */
export function dropEmptySettings(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string' && v.trim() === '') {
      delete env[k];
      dropped.push(k);
    }
  }
  return dropped;
}

/** web-push wants "mailto:..." or an https URL; accept a bare email address too. */
export function pushSubject(raw: string | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v) return 'mailto:letsgo@example.com';
  if (/^mailto:\S+@\S+$/i.test(v) || /^https:\/\/\S+$/i.test(v)) return v;
  if (/^\S+@\S+\.\S+$/.test(v)) return `mailto:${v}`;
  return null;
}
