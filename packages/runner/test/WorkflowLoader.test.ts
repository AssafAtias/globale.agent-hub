import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { WorkflowLoader } from '../src/context/WorkflowLoader.js';

function dirWith(name: string, body: string): string {
  const d = mkdtempSync(join(tmpdir(), 'wf-'));
  writeFileSync(join(d, `${name}.md`), body, 'utf8');
  return d;
}

describe('WorkflowLoader', () => {
  it('returns empty string for null/missing name', () => {
    expect(new WorkflowLoader(tmpdir()).load(null)).toBe('');
    expect(new WorkflowLoader(tmpdir()).load('does-not-exist')).toBe('');
  });

  it('loads the full markdown body, stripping frontmatter', () => {
    const d = dirWith('wf', '---\ntitle: x\n---\n# Workflow\nStep one.');
    const out = new WorkflowLoader(d).load('wf');
    expect(out).toContain('# Workflow');
    expect(out).toContain('Step one.');
    expect(out).not.toContain('title: x');
  });
});
