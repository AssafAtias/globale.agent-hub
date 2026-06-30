import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { resolveRepoPaths } from './repoPaths.js';

export class LocalEnricher {
  constructor(private reposRoot: string) {}

  enrich(contextStr: string, repos: string[]): string {
    const ctx = (() => { try { return JSON.parse(contextStr || '{}') as Record<string, string>; } catch { return {} as Record<string, string>; } })();
    for (const repoPath of resolveRepoPaths(this.reposRoot, repos)) {
      const claudeMd = join(repoPath, 'CLAUDE.md');
      if (existsSync(claudeMd)) {
        ctx['CLAUDE.md'] = readFileSync(claudeMd, 'utf-8').slice(0, 8000);
        break;
      }
    }
    return JSON.stringify(ctx);
  }
}
