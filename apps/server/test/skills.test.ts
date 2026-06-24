import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SkillCatalog, parseFrontmatter } from '../src/services/SkillCatalog.js';

function makeSkillsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'skills-'));
  const write = (name: string, md: string) => {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, 'SKILL.md'), md);
  };
  write('pr-review', '---\nname: pr-review\ndescription: Review PRs thoroughly\n---\n# body');
  write('testing', '---\nname: testing\ndescription: Write tests first\n---\n# body');
  // folder with no SKILL.md → skipped
  mkdirSync(join(dir, 'empty-folder'), { recursive: true });
  // SKILL.md with no name → skipped
  write('no-name', '---\ndescription: missing name\n---\n# body');
  return dir;
}

describe('parseFrontmatter', () => {
  it('extracts name and description', () => {
    const fm = parseFrontmatter('---\nname: foo\ndescription: bar baz\n---\nbody');
    expect(fm).toEqual({ name: 'foo', description: 'bar baz' });
  });
  it('returns empty object when no frontmatter', () => {
    expect(parseFrontmatter('# just a heading')).toEqual({});
  });
});

describe('SkillCatalog', () => {
  it('lists skills sorted by name, skipping invalid folders', () => {
    const dir = makeSkillsDir();
    try {
      const list = new SkillCatalog(dir).list();
      expect(list).toEqual([
        { name: 'pr-review', description: 'Review PRs thoroughly' },
        { name: 'testing', description: 'Write tests first' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('returns empty array when skillsDir does not exist', () => {
    expect(new SkillCatalog(join(tmpdir(), 'does-not-exist-xyz')).list()).toEqual([]);
  });
});
