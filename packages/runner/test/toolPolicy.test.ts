import { describe, it, expect } from 'vitest';
import { buildToolArgs } from '../src/toolPolicy.js';

describe('buildToolArgs', () => {
  it('returns [] when disabled', () => {
    expect(buildToolArgs({ enabled: false, repoPaths: ['/a', '/b'] })).toEqual([]);
  });

  it('emits permission-mode dontAsk and double-quoted read-only tools', () => {
    const args = buildToolArgs({ enabled: true, repoPaths: ['/a'] });
    expect(args.slice(0, 2)).toEqual(['--permission-mode', 'dontAsk']);
    expect(args).toContain('--allowedTools');
    expect(args).toContain('"Read"');
    expect(args).toContain('"Grep"');
    expect(args).toContain('"Glob"');
    expect(args).toContain('"Bash(git log:*)"');
    expect(args).toContain('"Bash(git rev-parse:*)"');
    // never bare
    expect(args).not.toContain('Read');
    expect(args).not.toContain('Bash(git log:*)');
  });

  it('explicitly disallows Write/Edit/NotebookEdit (quoted)', () => {
    const args = buildToolArgs({ enabled: true, repoPaths: ['/a'] });
    const i = args.indexOf('--disallowedTools');
    expect(i).toBeGreaterThan(-1);
    expect(args.slice(i + 1, i + 4)).toEqual(['"Write"', '"Edit"', '"NotebookEdit"']);
  });

  it('adds one --add-dir per NON-first repo path, quoted', () => {
    const args = buildToolArgs({ enabled: true, repoPaths: ['/a', '/b', '/c'] });
    const addDirs = args.filter((a) => a === '--add-dir');
    expect(addDirs).toHaveLength(2);
    expect(args).toContain('"/b"');
    expect(args).toContain('"/c"');
    expect(args).not.toContain('"/a"'); // first repo is the cwd, not an --add-dir
  });

  it('emits no --add-dir when one or zero repo paths', () => {
    expect(buildToolArgs({ enabled: true, repoPaths: ['/a'] }).filter((a) => a === '--add-dir')).toHaveLength(0);
    expect(buildToolArgs({ enabled: true, repoPaths: [] }).filter((a) => a === '--add-dir')).toHaveLength(0);
  });
});
