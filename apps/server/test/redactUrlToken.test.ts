import { redactUrlToken } from '../src/services/redactUrlToken.js';

describe('redactUrlToken', () => {
  it('redacts a token query value', () => {
    expect(redactUrlToken('/webhooks/bitbucket?token=secret123')).toBe('/webhooks/bitbucket?token=[REDACTED]');
  });
  it('redacts token among other params, preserving the rest', () => {
    expect(redactUrlToken('/x?a=1&token=abc&b=2')).toBe('/x?a=1&token=[REDACTED]&b=2');
  });
  it('leaves URLs without a token untouched', () => {
    expect(redactUrlToken('/webhooks/gitlab')).toBe('/webhooks/gitlab');
  });
  it('is case-insensitive on the param name', () => {
    expect(redactUrlToken('/x?Token=abc')).toBe('/x?Token=[REDACTED]');
  });
});
