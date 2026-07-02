import * as client from 'openid-client';
import type { Environment } from '../../config/environment.js';

export type OidcConfig = client.Configuration;

export interface Claims {
  entraObjectId: string;
  email: string;
  name: string;
}

/** Pure: derive our user fields from id_token claims. */
export function extractClaims(claims: Record<string, unknown>): Claims {
  const entraObjectId = String(claims.oid ?? claims.sub);
  const email = String(claims.email ?? claims.preferred_username ?? '');
  const name = String(claims.name ?? claims.preferred_username ?? email);
  return { entraObjectId, email, name };
}

let _cfg: Promise<OidcConfig> | null = null;

export function getOidc(env: Environment): Promise<OidcConfig> {
  if (!_cfg) {
    const issuer = new URL(
      `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/v2.0`,
    );
    _cfg = client.discovery(
      issuer,
      env.ENTRA_CLIENT_ID!,
      env.ENTRA_CLIENT_SECRET!,
    );
  }
  return _cfg;
}

export function buildLoginUrl(
  oidc: OidcConfig,
  p: {
    redirectUri: string;
    state: string;
    nonce: string;
    codeChallenge: string;
  },
): string {
  return client
    .buildAuthorizationUrl(oidc, {
      redirect_uri: p.redirectUri,
      scope: 'openid profile email',
      state: p.state,
      nonce: p.nonce,
      code_challenge: p.codeChallenge,
      code_challenge_method: 'S256',
    })
    .href;
}

export async function exchangeCode(
  oidc: OidcConfig,
  p: {
    currentUrl: string;
    state: string;
    nonce: string;
    codeVerifier: string;
  },
): Promise<Claims> {
  const tokens = await client.authorizationCodeGrant(
    oidc,
    new URL(p.currentUrl),
    {
      expectedState: p.state,
      expectedNonce: p.nonce,
      pkceCodeVerifier: p.codeVerifier,
    },
  );
  const claims = tokens.claims();
  if (!claims) throw new Error('No id_token claims');
  return extractClaims(claims as Record<string, unknown>);
}
