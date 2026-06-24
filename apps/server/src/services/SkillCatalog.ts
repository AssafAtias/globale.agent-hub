import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface SkillSummary {
  name: string;
  description: string;
}

/** Parse the leading YAML-ish frontmatter block for `name` and `description`. */
export function parseFrontmatter(md: string): { name?: string; description?: string } {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const block = m[1];
  const name = block.match(/^name:\s*(.+?)\s*$/m)?.[1];
  const description = block.match(/^description:\s*(.+?)\s*$/m)?.[1];
  return { ...(name ? { name } : {}), ...(description ? { description } : {}) };
}

export class SkillCatalog {
  constructor(private skillsDir: string) {}

  list(): SkillSummary[] {
    if (!existsSync(this.skillsDir)) return [];
    const out: SkillSummary[] = [];
    for (const entry of readdirSync(this.skillsDir)) {
      const skillMd = join(this.skillsDir, entry, 'SKILL.md');
      if (!existsSync(skillMd)) continue;
      try {
        const fm = parseFrontmatter(readFileSync(skillMd, 'utf-8'));
        if (!fm.name) continue;
        out.push({ name: fm.name, description: fm.description ?? '' });
      } catch {
        // skip unreadable skill
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
}
