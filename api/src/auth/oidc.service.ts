import { Injectable, Logger } from '@nestjs/common';
import { createHash, createPublicKey, JsonWebKey, verify } from 'crypto';
import { MSA_TENANT, ProviderConfig } from './auth.config';
import { randomToken } from './crypto.util';

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export interface OidcProfile {
  subject: string;
  email: string;
  /** True only when the provider vouches that the person owns the address. */
  emailVerified: boolean;
  name: string;
}

export interface PendingFlow {
  state: string;
  verifier: string;
  nonce: string;
  url: string;
}

const HOUR = 60 * 60_000;

/**
 * Minimal OpenID Connect client: authorization code flow with PKCE, and
 * id_token signature and claim checks. Works for Google and Microsoft.
 */
@Injectable()
export class OidcService {
  private readonly log = new Logger('Oidc');
  private readonly discovery = new Map<
    string,
    { at: number; doc: Discovery }
  >();
  private readonly jwks = new Map<
    string,
    { at: number; keys: (JsonWebKey & { kid?: string })[] }
  >();

  async start(cfg: ProviderConfig): Promise<PendingFlow> {
    const d = await this.discover(cfg.issuer);
    const state = randomToken(24);
    const verifier = randomToken(48);
    const nonce = randomToken(24);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return { state, verifier, nonce, url: `${d.authorization_endpoint}?${q}` };
  }

  async finish(
    cfg: ProviderConfig,
    code: string,
    verifier: string,
    nonce: string,
  ): Promise<OidcProfile> {
    const d = await this.discover(cfg.issuer);
    const res = await fetch(d.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: cfg.redirectUri,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      id_token?: string;
      error?: string;
    };
    if (!res.ok || !body.id_token)
      throw new Error(
        `Token exchange failed (${res.status} ${body.error ?? ''})`,
      );
    const claims = await this.verifyIdToken(cfg, d, body.id_token, nonce);
    return this.profile(cfg, claims);
  }

  private async verifyIdToken(
    cfg: ProviderConfig,
    d: Discovery,
    token: string,
    nonce: string,
  ): Promise<Record<string, unknown>> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Malformed id_token');
    const header = JSON.parse(
      Buffer.from(parts[0], 'base64url').toString(),
    ) as { alg?: string; kid?: string };
    if (header.alg !== 'RS256')
      throw new Error(`Unexpected id_token alg ${header.alg}`);
    const jwk = await this.key(d.jwks_uri, header.kid);
    const ok = verify(
      'RSA-SHA256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      createPublicKey({ key: jwk, format: 'jwk' }),
      Buffer.from(parts[2], 'base64url'),
    );
    if (!ok) throw new Error('Bad id_token signature');
    const c = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString(),
    ) as Record<string, unknown>;
    const now = Date.now() / 1000;
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    if (!aud.includes(cfg.clientId))
      throw new Error('id_token audience mismatch');
    if (typeof c.exp !== 'number' || c.exp < now - 60)
      throw new Error('id_token expired');
    if (typeof c.iat === 'number' && c.iat > now + 300)
      throw new Error('id_token from the future');
    if (c.nonce !== nonce) throw new Error('id_token nonce mismatch');
    const text = (v: unknown) => (typeof v === 'string' ? v : '');
    const expected = d.issuer.replace('{tenantid}', text(c.tid));
    const iss = text(c.iss);
    const issOk =
      iss === expected ||
      (expected === 'https://accounts.google.com' &&
        iss === 'accounts.google.com');
    if (!issOk) throw new Error(`id_token issuer mismatch (${iss})`);
    if (typeof c.sub !== 'string' || !c.sub)
      throw new Error('id_token has no subject');
    return c;
  }

  private profile(
    cfg: ProviderConfig,
    c: Record<string, unknown>,
  ): OidcProfile {
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    if (cfg.id === 'google') {
      return {
        subject: str(c.sub),
        email: str(c.email).toLowerCase(),
        emailVerified: c.email_verified === true || c.email_verified === 'true',
        name: str(c.name),
      };
    }
    // Microsoft: the address is only vouched for on personal accounts. A work or school
    // tenant's admin can put any address on a user, so those never match other sign-ins.
    const email = (str(c.email) || str(c.preferred_username)).toLowerCase();
    return {
      subject: `${str(c.tid)}:${str(c.oid) || str(c.sub)}`,
      email: email.includes('@') ? email : '',
      emailVerified: c.tid === MSA_TENANT && email.includes('@'),
      name: str(c.name),
    };
  }

  private async discover(issuer: string): Promise<Discovery> {
    const hit = this.discovery.get(issuer);
    if (hit && Date.now() - hit.at < HOUR) return hit.doc;
    const res = await fetch(
      `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
      {
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok)
      throw new Error(`OpenID discovery failed for ${issuer} (${res.status})`);
    const doc = (await res.json()) as Discovery;
    this.discovery.set(issuer, { at: Date.now(), doc });
    return doc;
  }

  private async key(uri: string, kid?: string): Promise<JsonWebKey> {
    const load = async (force: boolean) => {
      const hit = this.jwks.get(uri);
      if (hit && !force && Date.now() - hit.at < HOUR) return hit.keys;
      const res = await fetch(uri, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok)
        throw new Error(`Could not load signing keys (${res.status})`);
      const keys =
        ((await res.json()) as { keys: (JsonWebKey & { kid?: string })[] })
          .keys ?? [];
      this.jwks.set(uri, { at: Date.now(), keys });
      return keys;
    };
    let keys = await load(false);
    let k = keys.find((x) => x.kid === kid);
    if (!k) {
      // Providers rotate keys; refresh once before giving up.
      keys = await load(true);
      k = keys.find((x) => x.kid === kid);
    }
    if (!k) {
      this.log.warn(`No signing key ${kid} at ${uri}`);
      throw new Error('Unknown signing key');
    }
    return k;
  }
}
