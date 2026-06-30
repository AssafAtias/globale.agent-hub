const KEY_RE = /\b[A-Z][A-Z0-9]+-\d+\b/;

/** First Jira-style key (e.g. CORE-211920) scanning branch → title → description. */
export function extractIssueKey(sourceBranch: string, title: string, description: string): string | null {
  for (const field of [sourceBranch, title, description]) {
    const m = (field ?? '').match(KEY_RE);
    if (m) return m[0];
  }
  return null;
}
