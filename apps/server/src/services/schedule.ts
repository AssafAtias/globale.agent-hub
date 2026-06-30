import { Cron } from 'croner';

/** True when a scheduled slot has elapsed since the last scheduled run (or it never ran). */
export function isDue(cronExpr: string, lastScheduledAtIso: string | null, now: Date): boolean {
  try {
    const cron = new Cron(cronExpr);
    if (lastScheduledAtIso === null) {
      // Never fired: due if the expression yields any upcoming run (valid recurring schedule).
      return cron.nextRun(now) !== null;
    }
    // Due if a scheduled slot fell in (lastScheduled, now]. nextRun handles non-uniform schedules natively.
    const next = cron.nextRun(new Date(lastScheduledAtIso));
    return next !== null && next.getTime() <= now.getTime();
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
