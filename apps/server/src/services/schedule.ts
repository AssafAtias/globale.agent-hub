import { Cron } from 'croner';

/**
 * Compute the most recent scheduled slot at or before `now`.
 * Uses msToNext to derive the interval, avoiding the absent `previousRuns` API in croner 9.x.
 * Returns null when the cron has no previous slot (e.g. startAt is in the future).
 */
function getPreviousSlot(cronExpr: string, now: Date): Date | null {
  const c = new Cron(cronExpr);
  const msToNext = c.msToNext(now);
  if (msToNext === null) return null;
  const nextRun = new Date(now.getTime() + msToNext);
  const interval = c.msToNext(new Date(nextRun.getTime() + 1));
  if (interval === null) return null;
  // Round down to nearest second to get the exact slot start
  return new Date(Math.floor((nextRun.getTime() - interval) / 1000) * 1000);
}

/** True when a scheduled slot has elapsed since the last scheduled run (or it never ran). */
export function isDue(cronExpr: string, lastScheduledAtIso: string | null, now: Date): boolean {
  try {
    const prev = getPreviousSlot(cronExpr, now);
    if (!prev) return false;
    if (lastScheduledAtIso === null) return true;
    return new Date(lastScheduledAtIso) < prev;
  } catch {
    return false;
  }
}

/** Extract a non-empty `cron` string from an agent's triggerRules JSON, else null. */
export function parseCronFromTriggerRules(triggerRulesJson: string): string | null {
  try {
    const rules = JSON.parse(triggerRulesJson || '{}') as { cron?: unknown };
    const cron = typeof rules.cron === 'string' ? rules.cron.trim() : '';
    return cron.length > 0 ? cron : null;
  } catch {
    return null;
  }
}

const SCHEDULED_PREAMBLE =
  'This is a scheduled (cron) run with no triggering event. Use your available tools to inspect the repo(s) and carry out your task.';

/** Default context for a scheduled run: a preamble plus the agent's repo list. */
export function buildScheduledContext(reposJson: string): string {
  const ctx: Record<string, string> = { 'Scheduled run': SCHEDULED_PREAMBLE };
  try {
    const repos = JSON.parse(reposJson || '[]');
    if (Array.isArray(repos) && repos.length > 0) ctx['Repos'] = repos.join(', ');
  } catch { /* preamble only */ }
  return JSON.stringify(ctx);
}
