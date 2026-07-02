import { AgentRepository } from './AgentRepository.js';
import { RunRepository } from './RunRepository.js';
import { isDue, parseCronFromTriggerRules, buildScheduledContext } from './schedule.js';

/** One scheduler pass: create a schedule run for every enabled agent whose cron slot is due. */
export function runDueAgents(now: Date): void {
  for (const agent of AgentRepository.findAll()) {
    try {
      if (!agent.enabled) continue; // findAll already excludes archived
      const cron = parseCronFromTriggerRules(agent.triggerRules);
      if (!cron) continue;
      const last = RunRepository.lastScheduledRun(agent.id)?.createdAt ?? null;
      if (isDue(cron, last, now)) {
        RunRepository.create({
          agentId: agent.id,
          trigger: 'schedule',
          triggerPayload: '{}',
          context: buildScheduledContext(agent.repos),
          userId: agent.ownerId ?? null,
        });
      }
    } catch (e) {
      console.error('[Scheduler] agent', agent.id, 'failed:', e);
    }
  }
}

/** Start the 60s scheduler tick (runs once immediately). Returns a stop function. */
export function startScheduler(intervalMs = 60_000): () => void {
  const tick = () => {
    try { runDueAgents(new Date()); }
    catch (e) { console.error('[Scheduler] tick failed:', e); }
  };
  tick();
  const handle = setInterval(tick, intervalMs);
  return () => clearInterval(handle);
}
