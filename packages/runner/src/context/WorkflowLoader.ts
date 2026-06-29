import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

function stripFrontmatter(md: string): string {
  const m = md.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  return m ? md.slice(m[0].length) : md;
}

export class WorkflowLoader {
  constructor(private workflowsDir: string) {}

  load(name?: string | null): string {
    if (!name) return '';
    const path = join(this.workflowsDir, `${name}.md`);
    if (!existsSync(path)) {
      console.warn(`[runner] workflow not found, skipping: ${name}`);
      return '';
    }
    try {
      return stripFrontmatter(readFileSync(path, 'utf-8').replace(/\r\n/g, '\n')).trim();
    } catch {
      console.warn(`[runner] workflow unreadable, skipping: ${name}`);
      return '';
    }
  }
}
