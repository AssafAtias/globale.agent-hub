import { RunRepository } from './RunRepository.js';

/** Periodically force-fail runs stuck in 'running'. Runs once immediately. Returns a stop fn. */
export function startRunReaper(intervalMs = 60_000, staleMs = 780_000): () => void {
  const tick = () => {
    try {
      const n = RunRepository.reapStale(staleMs, new Date());
      if (n > 0) console.error(`[RunReaper] force-failed ${n} stale run(s)`);
    } catch (e) { console.error('[RunReaper] tick failed:', e); }
  };
  tick();
  const handle = setInterval(tick, intervalMs);
  return () => clearInterval(handle);
}
