import type { ProbeResult } from './probe.js';

export type State = 'unknown' | 'healthy' | 'failing';
export type Action = 'none' | 'failure' | 'recovery' | 'heartbeat';

/**
 * Decide the next state and whether/what to post.
 * Rules (order matters — failure and recovery beat heartbeat):
 *  - probe failed                    → failing / 'failure'
 *  - probe ok and previously failing → healthy / 'recovery'
 *  - probe ok and daily tick         → healthy / 'heartbeat'
 *  - otherwise                       → healthy / 'none'  (higher-cadence future use)
 */
export function decide(
  prev: State,
  result: ProbeResult,
  isDailyTick: boolean,
): { next: State; action: Action } {
  if (!result.ok) return { next: 'failing', action: 'failure' };
  if (prev === 'failing') return { next: 'healthy', action: 'recovery' };
  if (isDailyTick) return { next: 'healthy', action: 'heartbeat' };
  return { next: 'healthy', action: 'none' };
}
