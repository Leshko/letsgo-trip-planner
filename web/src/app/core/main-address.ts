import { isNativeApp } from './platform';
/**
 * The app has one main web address (PUBLIC_URL on the server). When it's
 * opened anywhere else (the old letsgo.jeremyleshko.com), carry whatever this
 * phone is signed in to across with one-time codes, then go there. Phones keep
 * sign-ins per address, so a plain redirect would make everyone start over.
 *
 * Never risks a sign-in: if a code can't be made for any reason other than
 * the sign-in being invalid, the app simply stays on this address.
 */
export async function moveToMainAddress(): Promise<void> {
  if (isNativeApp()) return;
  const target = await mainOrigin();
  if (!target || target === location.origin) return;

  const params = new URLSearchParams();
  const member = read('letsgo.token');
  const account = read('letsgo.account');
  try {
    if (member) {
      const code = await oneTimeCode('/api/trips/me/transfer-code', { Authorization: `Bearer ${member}` });
      if (code) params.set('trip', code);
    }
    if (account) {
      const code = await oneTimeCode('/api/account/handoff', { 'X-Account': account });
      if (code) params.set('account', code);
    }
  } catch {
    return; // server unreachable or erroring: stay here, nothing lost
  }

  const path = location.pathname + location.search;
  if (params.size) {
    params.set('next', path);
    location.replace(`${target}/handoff?${params}`);
  } else {
    location.replace(target + path);
  }
  // The page is leaving; don't start the app here.
  await new Promise(() => undefined);
}

async function mainOrigin(): Promise<string | null> {
  try {
    const r = await fetch('/api/config', { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const { publicUrl } = (await r.json()) as { publicUrl: string | null };
    return publicUrl ? new URL(publicUrl).origin : null;
  } catch {
    return null;
  }
}

/** A one-time code, null when this phone's sign-in is no longer valid; throws on anything else. */
async function oneTimeCode(path: string, headers: Record<string, string>): Promise<string | null> {
  const r = await fetch(path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(8000) });
  if (r.status === 401 || r.status === 403) return null;
  if (!r.ok) throw new Error(`hand-off code failed (${r.status})`);
  return ((await r.json()) as { code: string }).code;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
