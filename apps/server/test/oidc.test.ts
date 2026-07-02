import { extractClaims } from '../src/services/auth/oidc.js';

describe('extractClaims', () => {
  it('maps oid/email/name from id_token claims', () => {
    const c = extractClaims({ oid: 'OID', email: 'e@x', name: 'N' } as any);
    expect(c).toEqual({ entraObjectId: 'OID', email: 'e@x', name: 'N' });
  });
  it('falls back to preferred_username and sub', () => {
    const c = extractClaims({ sub: 'S', preferred_username: 'p@x' } as any);
    expect(c.entraObjectId).toBe('S');
    expect(c.email).toBe('p@x');
    expect(c.name).toBe('p@x');
  });
});
