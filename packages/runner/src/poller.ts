import type { RunnerConfig } from './config.js';
import { executeJob, type Job } from './executor.js';

export async function startPollLoop(config: RunnerConfig): Promise<never> {
  console.log(`[runner] Starting poll loop → ${config.orchestratorUrl}`);

  while (true) {
    try {
      const res = await fetch(`${config.orchestratorUrl}/api/runs/next`, {
        headers: { 'x-runner-token': config.runnerToken },
        signal: AbortSignal.timeout(35_000), // slightly > server 30s hold
      });

      if (res.status === 204) {
        // no jobs, loop immediately
        continue;
      }

      if (!res.ok) {
        console.error(`[runner] poll error: ${res.status} ${await res.text()}`);
        await sleep(5000);
        continue;
      }

      const job = (await res.json()) as Job;
      console.log(`[runner] Claimed run ${job.run.id} for agent "${job.agent.name}"`);

      try {
        const result = await executeJob(job, config.anthropicApiKey);
        await postResult(config, job.run.id, { result });
        console.log(`[runner] Run ${job.run.id} completed`);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await postResult(config, job.run.id, { error });
        console.error(`[runner] Run ${job.run.id} failed: ${error}`);
      }
    } catch (err) {
      console.error('[runner] Poll loop error:', err);
      await sleep(5000);
    }
  }
}

async function postResult(
  config: RunnerConfig,
  runId: string,
  body: { result?: string; error?: string },
) {
  await fetch(`${config.orchestratorUrl}/api/runs/${runId}/result`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-runner-token': config.runnerToken,
    },
    body: JSON.stringify(body),
  });
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
