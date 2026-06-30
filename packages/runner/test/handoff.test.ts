import { describe, it, expect } from 'vitest';
import { extractHandoff } from '../src/executor.js';

describe('extractHandoff', () => {
  it('returns null + original text when no handoff block', () => {
    const r = extractHandoff('review done, looks good');
    expect(r.handoff).toBeNull();
    expect(r.result).toBe('review done, looks good');
  });
  it('parses a handoff block and strips it from the result', () => {
    const r = extractHandoff('Found issues.\n<handoff>{"agent":"fixer","message":"fix X"}</handoff>');
    expect(r.handoff).toEqual({ agent: 'fixer', message: 'fix X' });
    expect(r.result).toBe('Found issues.');
  });
  it('throws on malformed JSON', () => {
    expect(() => extractHandoff('<handoff>{nope}</handoff>')).toThrow();
  });
  it('throws when agent or message missing', () => {
    expect(() => extractHandoff('<handoff>{"agent":"fixer"}</handoff>')).toThrow();
  });
});
