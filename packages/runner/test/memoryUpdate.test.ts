import { describe, it, expect } from 'vitest';
import { extractMemoryUpdate } from '../src/executor.js';

describe('extractMemoryUpdate', () => {
  it('extracts and strips the first memory-update block', () => {
    const text = 'Review done.\n\n<memory-update>\nMerchant X needs RTL fix.\n</memory-update>';
    const { result, note } = extractMemoryUpdate(text);
    expect(note).toBe('Merchant X needs RTL fix.');
    expect(result).toBe('Review done.');
    expect(result).not.toContain('<memory-update>');
  });

  it('returns null note and unchanged result when no block present', () => {
    const { result, note } = extractMemoryUpdate('Just a normal answer.');
    expect(note).toBeNull();
    expect(result).toBe('Just a normal answer.');
  });

  it('takes only the first block', () => {
    const text = 'A<memory-update>one</memory-update>B<memory-update>two</memory-update>';
    const { note } = extractMemoryUpdate(text);
    expect(note).toBe('one');
  });

  it('treats an empty block as no note', () => {
    const { note } = extractMemoryUpdate('done <memory-update>   </memory-update>');
    expect(note).toBeNull();
  });
});
