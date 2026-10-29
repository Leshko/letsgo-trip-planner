import { createHash, createSign, generateKeyPairSync, KeyObject } from 'crypto';
import * as nodeHttp from 'http';
import { AddressInfo } from 'net';

/**
 * A stand-in for Google/Microsoft: discovery, signing keys, and a token
 * endpoint that checks PKCE and returns a signed id_token.
 */
export class FakeOidc {
  issuer = '';
  clientId = 'test-client';
  private server!: nodeHttp.Server;
  private readonly key = generateKeyPairSync('rsa', { modulusLength: 2048 });
  private readonly otherKey = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  /** code → what the id_token should say, and the PKCE challenge it must match. */
  readonly grants = new Map<
    string,
    {
      claims: Record<string, unknown>;
      challenge: string;
      tamper?: 'sig' | 'aud' | 'nonce';
    }
  >();
  issuerTemplate: string | null = null;

  async start(): Promise<void> {
    this.server = nodeHttp.createServer((req, res) => {
      const url = new URL(req.url ?? '/', this.issuer || 'http://x');
      const json = (code: number, body: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (url.pathname.endsWith('/.well-known/openid-configuration'))
        return json(200, {
          issuer: this.issuerTemplate ?? this.issuer,
          authorization_endpoint: `${this.issuer}/authorize`,
          token_endpoint: `${this.issuer}/token`,
          jwks_uri: `${this.issuer}/jwks`,
        });
      if (url.pathname === '/jwks') {
        const jwk = this.key.publicKey.export({ format: 'jwk' });
        return json(200, {
          keys: [{ ...jwk, kid: 'k1', alg: 'RS256', use: 'sig' }],
        });
      }
      if (url.pathname === '/token' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const p = new URLSearchParams(body);
          const g = this.grants.get(p.get('code') ?? '');
          if (!g) return json(400, { error: 'invalid_grant' });
          const challenge = createHash('sha256')
            .update(p.get('code_verifier') ?? '')
            .digest('base64url');
          if (challenge !== g.challenge || p.get('client_id') !== this.clientId)
            return json(400, { error: 'invalid_grant' });
          this.grants.delete(p.get('code') ?? '');
          const claims = { ...g.claims };
          if (g.tamper === 'aud') claims.aud = 'someone-else';
          if (g.tamper === 'nonce') claims.nonce = 'wrong';
          const key =
            g.tamper === 'sig' ? this.otherKey.privateKey : this.key.privateKey;
          return json(200, {
            id_token: this.sign(claims, key),
            access_token: 'x',
          });
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.issuer = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop(): Promise<void> {
    return new Promise((r) => this.server.close(() => r()));
  }

  /** Pretend the person signed in at the provider; returns the code the provider would send back. */
  approve(
    authorizeUrl: string,
    claims: Record<string, unknown>,
    tamper?: 'sig' | 'aud' | 'nonce',
  ): { code: string; state: string } {
    const u = new URL(authorizeUrl);
    const code = `code-${Math.random().toString(36).slice(2)}`;
    const now = Math.floor(Date.now() / 1000);
    this.grants.set(code, {
      challenge: u.searchParams.get('code_challenge') ?? '',
      tamper,
      claims: {
        iss: claims.tid
          ? (this.issuerTemplate ?? this.issuer).replace(
              '{tenantid}',
              claims.tid as string,
            )
          : this.issuer,
        aud: this.clientId,
        iat: now,
        exp: now + 600,
        nonce: u.searchParams.get('nonce'),
        ...claims,
      },
    });
    return { code, state: u.searchParams.get('state') ?? '' };
  }

  private sign(claims: Record<string, unknown>, key: KeyObject): string {
    const enc = (o: unknown) =>
      Buffer.from(JSON.stringify(o)).toString('base64url');
    const input = `${enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' })}.${enc(claims)}`;
    const sig = createSign('RSA-SHA256')
      .update(input)
      .sign(key)
      .toString('base64url');
    return `${input}.${sig}`;
  }
}
