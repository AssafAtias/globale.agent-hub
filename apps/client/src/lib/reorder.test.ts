import { describe, it, expect } from 'vitest';
import { computeReorder } from './reorder.js';

describe('computeReorder', () => {
  it('moves an item forward', () => {
    expect(computeReorder(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']);
  });
  it('moves an item backward', () => {
    expect(computeReorder(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
  });
  it('returns input unchanged when ids are equal', () => {
    expect(computeReorder(['a', 'b', 'c'], 'b', 'b')).toEqual(['a', 'b', 'c']);
  });
  it('returns input unchanged when an id is missing', () => {
    expect(computeReorder(['a', 'b', 'c'], 'a', 'z')).toEqual(['a', 'b', 'c']);
  });
});
