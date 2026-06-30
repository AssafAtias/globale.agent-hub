import { bitbucketAuthHeader, prJsonToMrContext } from '../src/services/BitbucketClient.js';

describe('bitbucketAuthHeader', () => {
  it('returns Bearer when no username', () => {
    expect(bitbucketAuthHeader('tok')).toBe('Bearer tok');
  });
  it('returns Basic base64(username:token) when username set', () => {
    expect(bitbucketAuthHeader('tok', 'alice')).toBe(`Basic ${Buffer.from('alice:tok').toString('base64')}`);
  });
});

describe('prJsonToMrContext', () => {
  it('maps PR JSON fields plus the passed diff', () => {
    const pr = {
      title: 'T', description: 'D',
      source: { branch: { name: 'feat' } },
      destination: { branch: { name: 'main' } },
      links: { html: { href: 'https://bb/pr/1' } },
    };
    expect(prJsonToMrContext(pr, 'DIFF')).toEqual({
      title: 'T', description: 'D', sourceBranch: 'feat',
      targetBranch: 'main', mrUrl: 'https://bb/pr/1', diff: 'DIFF',
    });
  });
  it('defaults a missing description to empty string', () => {
    const pr = { title: 'T', source: { branch: { name: 'f' } }, destination: { branch: { name: 'm' } }, links: { html: { href: 'u' } } };
    expect(prJsonToMrContext(pr, '').description).toBe('');
  });
});
