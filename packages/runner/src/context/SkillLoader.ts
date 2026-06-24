import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const MAX_SKILL_CHARS = 6000;
const MAX_SKILLS_TOTAL_CHARS = 24000;

function stripFrontmatter(md: string): string {
  const m = md.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  return m ? md.slice(m[0].length) : md;
}

export class SkillLoader {
  constructor(private skillsDir: string) {}

  /** Resolve a skill's SKILL.md path by folder name, falling back to a scan
   *  for a SKILL.md whose frontmatter `name:` matches. Returns null if absent. */
  private resolve(name: string): string | null {
    const direct = join(this.skillsDir, name, 'SKILL.md');
    if (existsSync(direct)) return direct;
    if (!existsSync(this.skillsDir)) return null;
    for (const entry of readdirSync(this.skillsDir)) {
      const p = join(this.skillsDir, entry, 'SKILL.md');
      if (!existsSync(p)) continue;
      try {
        const raw = readFileSync(p, 'utf-8').replace(/\r\n/g, '\n');
        const fmName = raw.match(/^name:\s*(.+?)\s*$/m)?.[1];
        if (fmName === name) return p;
      } catch { /* skip */ }
    }
    return null;
  }

  load(skillNames: string[]): string {
    const sections: string[] = [];
    let total = 0;
    for (const name of skillNames) {
      const path = this.resolve(name);
      if (!path) {
        console.warn(`[runner] skill not found, skipping: ${name}`);
        continue;
      }
      try {
        const raw = readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
        const body = stripFrontmatter(raw).trim().slice(0, MAX_SKILL_CHARS);
        const section = `### ${name}\n\n${body}`;
        const sep = sections.length > 0 ? 2 : 0;
        if (total + sep + section.length > MAX_SKILLS_TOTAL_CHARS) break;
        sections.push(section);
        total += sep + section.length;
      } catch {
        console.warn(`[runner] skill unreadable, skipping: ${name}`);
      }
    }
    return sections.join('\n\n');
  }
}
