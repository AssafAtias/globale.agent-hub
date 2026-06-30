import { describe, it, expect } from 'vitest';
import { extractGate } from '../src/executor.js';

describe('extractGate', () => {
  it('returns null when no gate block', () => {
    expect(extractGate('all done, opened MR !12').gate).toBeNull();
  });
  it('parses a valid gate block', () => {
    const text = 'Summary.\n<gate>{"id":"confirm","summary":"s","question":"q","kind":"approve_reject"}</gate>';
    expect(extractGate(text).gate?.id).toBe('confirm');
    expect(extractGate(text).gate?.kind).toBe('approve_reject');
  });
  it('throws on malformed gate JSON', () => {
    expect(() => extractGate('<gate>{not json}</gate>')).toThrow();
  });
  it('throws when required fields missing', () => {
    expect(() => extractGate('<gate>{"summary":"s"}</gate>')).toThrow();
  });
});
