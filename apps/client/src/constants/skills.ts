export function normalizeSkill(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

export function dedupeSkills(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const s = normalizeSkill(raw);
    if (!s) continue;
    const k = s.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(s); }
  }
  return out;
}
