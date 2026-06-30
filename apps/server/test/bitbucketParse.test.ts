import { parseBitbucketEvent } from '../src/services/WebhookMatcher.js';

const body = {
  repository: { full_name: 'globaleteam/core' },
  pullrequest: { id: 7, source: { branch: { name: 'feature/CORE-9-x' } } },
};

describe('parseBitbucketEvent', () => {
  it('maps pullrequest:created → mr:opened with repo prefix + sourceRef', () => {
    expect(parseBitbucketEvent(body, 'pullrequest:created')).toEqual({
      platform: 'bitbucket', repo: 'bitbucket:globaleteam/core',
      eventType: 'mr:opened', sourceRef: 'feature/CORE-9-x', payload: body,
    });
  });
  it('maps pullrequest:updated → mr:updated', () => {
    expect(parseBitbucketEvent(body, 'pullrequest:updated')?.eventType).toBe('mr:updated');
  });
  it('maps pullrequest:fulfilled → mr:merged', () => {
    expect(parseBitbucketEvent(body, 'pullrequest:fulfilled')?.eventType).toBe('mr:merged');
  });
  it('returns null for an unmapped event key', () => {
    expect(parseBitbucketEvent(body, 'pullrequest:rejected')).toBeNull();
  });
  it('returns null when repository.full_name is missing', () => {
    expect(parseBitbucketEvent({ pullrequest: { id: 1 } }, 'pullrequest:created')).toBeNull();
  });
});
