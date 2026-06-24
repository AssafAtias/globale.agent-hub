import type { RunnerConfig } from './config.js';
import { executeJob, isJob } from './executor.js';

export async function startPollLoop(config: RunnerConfig): Promise<never> {
  console.log(`[runner] Starting poll loop → ${config.orchestratorUrl}`);

  while (true) {
    try {
      const res = await fetch(`${config.orchestratorUrl}/api/runs/next`, {
        headers: {
          'x-runner-token': config.runnerToken,
          'x-runner-name': config.runnerName,
        },
        signal: AbortSignal.timeout(35_000),
      });

      if (res.status === 204) {
        continue;
      }

      if (!res.ok) {
        console.error(`[runner] poll error: ${res.status} ${await res.text()}`);
        await sleep(5000);
        continue;
      }

      const raw = await res.json();
      if (!isJob(raw)) {
        console.error('[runner] Unexpected job shape from server:', JSON.stringify(raw).slice(0, 200));
        await sleep(5000);
        continue;
      }
      const job = raw;
      console.log(`[runner] Claimed run ${job.run.id} for agent "${job.agent.name}"`);

      try {
        const result = await executeJob(job, config.anthropicApiKey, config.localReposRoot);
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
  const res = await fetch(`${config.orchestratorUrl}/api/runs/${runId}/result`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-runner-token': config.runnerToken,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`postResult failed: ${res.status} ${await res.text()}`);
  }
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
