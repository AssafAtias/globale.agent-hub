import { existsSync } from 'fs';
import { join, relative, isAbsolute } from 'path';

/**
 * Resolve an agent's `repos` entries (e.g. "gitlab:global-e/core/checkout/Apps")
 * to local directory paths under `reposRoot`, keeping only those that exist.
 * De-duplicated and order-preserving.
 * Entries that escape reposRoot via path traversal (e.g. `..`) are rejected.
 */
export function resolveRepoPaths(reposRoot: string, repos: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const repo of repos) {
    const name = repo.split('/').pop() ?? repo;
    const dirPath = join(reposRoot, name);
    // Reject any path that escapes reposRoot (path traversal containment)
    const rel = relative(reposRoot, dirPath);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) continue;
    if (seen.has(dirPath)) continue;
    seen.add(dirPath);
    if (existsSync(dirPath)) result.push(dirPath);
  }
  return result;
}
