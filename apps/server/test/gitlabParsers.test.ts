import { parsePipeline, parseFailedJobs, parseDiscussions } from '../src/services/GitLabClient.js';

describe('parsePipeline', () => {
  it('returns the first element id+status (GitLab lists newest-first)', () => {
    expect(parsePipeline([{ id: 5, status: 'failed' }, { id: 4, status: 'success' }]))
      .toEqual({ id: 5, status: 'failed' });
  });
  it('returns null for empty / non-array / missing numeric id', () => {
    expect(parsePipeline([])).toBeNull();
    expect(parsePipeline(null)).toBeNull();
    expect(parsePipeline([{ status: 'failed' }])).toBeNull();
  });
});

describe('parseFailedJobs', () => {
  it('returns names of jobs with status "failed" only', () => {
    expect(parseFailedJobs([
      { name: 'build', status: 'failed' },
      { name: 'test', status: 'success' },
      { name: 'lint', status: 'failed' },
    ])).toEqual(['build', 'lint']);
  });
  it('returns [] for non-array / empty', () => {
    expect(parseFailedJobs(null)).toEqual([]);
    expect(parseFailedJobs([])).toEqual([]);
  });
});

describe('parseDiscussions', () => {
  it('flattens notes across discussions, drops system notes, maps author/body', () => {
    const input = [
      { notes: [{ system: true, body: 'changed status', author: { name: 'Bot' } }] },
      { notes: [{ system: false, body: 'Looks good', author: { name: 'Alice' } }] },
      { notes: [{ body: 'nit', author: { username: 'bob' } }] },
    ];
    expect(parseDiscussions(input)).toEqual([
      { author: 'Alice', body: 'Looks good' },
      { author: 'bob', body: 'nit' },
    ]);
  });
  it('author falls back to "unknown"; body sliced to 1000', () => {
    const out = parseDiscussions([{ notes: [{ body: 'x'.repeat(2000) }] }]);
    expect(out[0].author).toBe('unknown');
    expect(out[0].body).toHaveLength(1000);
  });
  it('caps at 30 after flattening', () => {
    const notes = Array.from({ length: 40 }, (_, i) => ({ body: `n${i}`, author: { name: 'A' } }));
    expect(parseDiscussions([{ notes }])).toHaveLength(30);
  });
  it('returns [] for non-array', () => {
    expect(parseDiscussions(null)).toEqual([]);
  });
});
