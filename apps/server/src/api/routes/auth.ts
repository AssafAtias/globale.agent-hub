import * as client from 'openid-client';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { Environment } from '../../config/environment.js';
import { authEnabled } from '../../config/environment.js';
import { getOidc, buildLoginUrl, exchangeCode } from '../../services/auth/oidc.js';
import { UserRepository } from '../../services/UserRepository.js';

// Extend the secure-session SessionData so typed get/set work for our keys.
declare module 'fastify' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace fastifySecureSession {
    interface SessionData {
      userId: string;
      oidc: { state: string; nonce: string; codeVerifier: string };
    }
  }
}

export function buildAuthRoutes(config: Environment): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.get('/api/me', async (req, reply) => {
      if (!req.user) return reply.status(401).send({ error: 'Authentication required' });
      const { id, email, name, role } = req.user;
      return { id, email, name, role };
    });

    if (!authEnabled(config)) return; // no SSO endpoints in open mode

    const redirectUri = `${config.PUBLIC_BASE_URL}/auth/callback`;

    app.get('/auth/login', async (req, reply) => {
      const oidc = await getOidc(config);
      const codeVerifier = client.randomPKCECodeVerifier();
      const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
      const state = client.randomState();
      const nonce = client.randomNonce();
      req.session.set('oidc', { state, nonce, codeVerifier });
      return reply.redirect(buildLoginUrl(oidc, { redirectUri, state, nonce, codeChallenge }));
    });

    app.get('/auth/callback', async (req, reply) => {
      const oidc = await getOidc(config);
      const saved = req.session.get('oidc') as { state: string; nonce: string; codeVerifier: string } | undefined;
      if (!saved) return reply.status(400).send({ error: 'No login in progress' });
      const currentUrl = `${config.PUBLIC_BASE_URL}${req.url}`;
      const claims = await exchangeCode(oidc, { currentUrl, ...saved });
      const user = UserRepository.upsertByEntraOid(claims);
      req.session.set('userId', user.id);
      req.session.set('oidc', undefined);
      return reply.redirect('/');
    });

    app.post('/auth/logout', async (req, reply) => {
      req.session.delete();
      return reply.status(204).send();
    });
  };
}
