export type OAuthProvider = 'google' | 'microsoft';
export const OAUTH_PROVIDERS: OAuthProvider[] = ['google', 'microsoft'];

export interface ProviderConfig {
  id: OAuthProvider;
  clientId: string;
  clientSecret: string;
  /** OpenID issuer; its /.well-known/openid-configuration describes everything else. */
  issuer: string;
  redirectUri: string;
}

/** Microsoft's tenant for personal accounts (Outlook, Hotmail, Xbox). */
export const MSA_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

/**
 * The address people use to reach the app, e.g. https://letsgotogether.app.
 * Sign-in redirects and emailed links are built from this, never from the
 * request's Host header, so a forged header can't send links elsewhere.
 */
export function publicUrl(): string | null {
  const raw = (process.env.PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+/i.test(raw) ? raw : null;
}

export function providerConfig(id: OAuthProvider): ProviderConfig | null {
  const base = publicUrl();
  const env = id.toUpperCase();
  const clientId = process.env[`${env}_CLIENT_ID`]?.trim();
  const clientSecret = process.env[`${env}_CLIENT_SECRET`]?.trim();
  if (!base || !clientId || !clientSecret) return null;
  const issuer =
    process.env[`${env}_ISSUER`]?.trim() ||
    (id === 'google'
      ? 'https://accounts.google.com'
      : `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT?.trim() || 'common'}/v2.0`);
  return {
    id,
    clientId,
    clientSecret,
    issuer,
    redirectUri: `${base}/api/auth/${id}/callback`,
  };
}

/** Only same-app paths, so a sign-in link can't bounce people to another site. */
export function safeReturnTo(v: unknown): string {
  return typeof v === 'string' &&
    v.length <= 300 &&
    /^\/(?!\/)[^\s\\]*$/.test(v)
    ? v
    : '/trips';
}
