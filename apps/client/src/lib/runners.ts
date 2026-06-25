import type { Runner } from '../api/client.js';

export function runnerStats(runners: Runner[]): { online: number; total: number } {
  return {
    online: runners.filter((r) => r.status === 'online').length,
    total: runners.length,
  };
}
