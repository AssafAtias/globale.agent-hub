import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SkillLoader } from '../src/context/SkillLoader.js';

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'skl-'));
  const write = (folder: string, md: string) => {
    mkdirSync(join(dir, folder), { recursive: true });
    writeFileSync(join(dir, folder, 'SKILL.md'), md);
  };
  write('pr-review', '---\nname: pr-review\ndescription: d\n---\nREVIEW BODY');
  write('testing', '---\nname: testing\ndescription: d\n---\nTEST BODY');
  return dir;
}

describe('SkillLoader', () => {
  it('loads bodies with frontmatter stripped, under per-skill headings', () => {
    const dir = makeDir();
    try {
      const out = new SkillLoader(dir).load(['pr-review', 'testing']);
      expect(out).toContain('### pr-review');
      expect(out).toContain('REVIEW BODY');
      expect(out).toContain('### testing');
      expect(out).toContain('TEST BODY');
      expect(out).not.toContain('---'); // frontmatter stripped
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips missing skills and returns empty string for none found', () => {
    const dir = makeDir();
    try {
      expect(new SkillLoader(dir).load(['does-not-exist'])).toBe('');
      const out = new SkillLoader(dir).load(['pr-review', 'does-not-exist']);
      expect(out).toContain('REVIEW BODY');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('caps each body to MAX_SKILL_CHARS (6000)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skl-'));
    try {
      mkdirSync(join(dir, 'big'), { recursive: true });
      writeFileSync(join(dir, 'big', 'SKILL.md'), '---\nname: big\n---\n' + 'x'.repeat(9000));
      const out = new SkillLoader(dir).load(['big']);
      const bodyLen = out.split('\n').filter((l) => l.startsWith('x')).join('').length;
      expect(bodyLen).toBeLessThanOrEqual(6000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns empty string for an empty skill list', () => {
    const dir = makeDir();
    try {
      expect(new SkillLoader(dir).load([])).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loads a skill with CRLF line endings correctly (frontmatter stripped)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skl-'));
    try {
      mkdirSync(join(dir, 'crlf-skill'), { recursive: true });
      // Write CRLF content simulating real skill files on Windows
      const crlfContent = '---\r\nname: crlf-skill\r\ndescription: d\r\n---\r\nCRLF BODY';
      writeFileSync(join(dir, 'crlf-skill', 'SKILL.md'), crlfContent);
      const out = new SkillLoader(dir).load(['crlf-skill']);
      expect(out).toContain('### crlf-skill');
      expect(out).toContain('CRLF BODY');
      expect(out).not.toContain('---'); // frontmatter stripped even with CRLF
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
