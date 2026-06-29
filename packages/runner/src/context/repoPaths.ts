import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Resolve an agent's `repos` entries (e.g. "gitlab:global-e/core/checkout/Apps")
 * to local directory paths under `reposRoot`, keeping only those that exist.
 * De-duplicated and order-preserving.
 */
export function resolveRepoPaths(reposRoot: string, repos: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const repo of repos) {
    const name = repo.split('/').pop() ?? repo;
    const path = join(reposRoot, name);
    if (seen.has(path)) continue;
    seen.add(path);
    if (existsSync(path)) result.push(path);
  }
  return result;
}
