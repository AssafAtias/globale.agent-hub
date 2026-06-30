import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveRepoPaths } from '../src/context/repoPaths.js';

describe('resolveRepoPaths', () => {
  it('resolves gitlab-style repo strings to existing dirs by last segment', () => {
    const root = mkdtempSync(join(tmpdir(), 'rp-'));
    try {
      mkdirSync(join(root, 'Apps'));
      const out = resolveRepoPaths(root, ['gitlab:global-e/core/checkout/Apps']);
      expect(out).toEqual([join(root, 'Apps')]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('omits repos whose directory does not exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'rp-'));
    try {
      mkdirSync(join(root, 'Apps'));
      const out = resolveRepoPaths(root, ['gitlab:x/Apps', 'gitlab:x/Missing']);
      expect(out).toEqual([join(root, 'Apps')]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('preserves order and de-dupes repos resolving to the same dir', () => {
    const root = mkdtempSync(join(tmpdir(), 'rp-'));
    try {
      mkdirSync(join(root, 'Apps'));
      mkdirSync(join(root, 'core'));
      const out = resolveRepoPaths(root, ['gitlab:a/core', 'gitlab:b/Apps', 'gitlab:c/Apps']);
      expect(out).toEqual([join(root, 'core'), join(root, 'Apps')]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('returns [] for empty input', () => {
    expect(resolveRepoPaths('/whatever', [])).toEqual([]);
  });

  it('rejects a repo that resolves to the parent dir (path traversal)', () => {
    const root = mkdtempSync(join(tmpdir(), 'rp-'));
    try {
      const out = resolveRepoPaths(root, ['gitlab:evil/..']);
      expect(out).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('rejects an empty-name or dot entry that resolves to reposRoot itself', () => {
    const root = mkdtempSync(join(tmpdir(), 'rp-'));
    try {
      // split('/').pop() of 'gitlab:evil/.' gives '.', join(root,'.') === root
      const out = resolveRepoPaths(root, ['gitlab:evil/.']);
      expect(out).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('still resolves valid repos alongside rejected traversal entries', () => {
    const root = mkdtempSync(join(tmpdir(), 'rp-'));
    try {
      mkdirSync(join(root, 'Apps'));
      const out = resolveRepoPaths(root, ['gitlab:evil/..', 'gitlab:global-e/Apps']);
      expect(out).toEqual([join(root, 'Apps')]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
