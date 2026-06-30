import { extractIssueKey } from '../src/services/issueKey.js';

describe('extractIssueKey', () => {
  it('extracts the key from the branch', () => {
    expect(extractIssueKey('feature/CORE-211920-some-fix', 'title', 'desc')).toBe('CORE-211920');
  });
  it('handles bug/CORE-123 style branches', () => {
    expect(extractIssueKey('bug/CORE-123', '', '')).toBe('CORE-123');
  });
  it('falls back to the title when the branch has no key', () => {
    expect(extractIssueKey('hotfix', 'Fix CORE-9 crash', '')).toBe('CORE-9');
  });
  it('falls back to the description', () => {
    expect(extractIssueKey('hotfix', 'no key', 'relates to CORE-42')).toBe('CORE-42');
  });
  it('returns null when there is no key anywhere', () => {
    expect(extractIssueKey('main', 'cleanup', 'no tickets here')).toBeNull();
  });
  it('branch wins over title', () => {
    expect(extractIssueKey('feature/CORE-1-x', 'mentions CORE-2', '')).toBe('CORE-1');
  });
});
