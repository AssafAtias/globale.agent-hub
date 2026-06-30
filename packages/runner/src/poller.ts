import type { RunnerConfig } from './config.js';
import { executeJob, isJob } from './executor.js';

async function fetchMemory(config: RunnerConfig, agentId: string): Promise<{ focus: string | null; entries: { note: string }[] }> {
  try {
    const res = await fetch(`${config.orchestratorUrl}/api/agents/${agentId}/memory`, {
      headers: { 'x-runner-token': config.runnerToken },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[runner] memory GET for agent ${agentId} returned ${res.status}`);
      return { focus: null, entries: [] };
    }
    return await res.json();
  } catch (err) {
    console.error(`[runner] failed to fetch memory for agent ${agentId}:`, err);
    return { focus: null, entries: [] };
  }
}

async function postMemory(config: RunnerConfig, agentId: string, body: { runId: string; note: string }) {
  try {
    await fetch(`${config.orchestratorUrl}/api/agents/${agentId}/memory`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-runner-token': config.runnerToken },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error(`[runner] failed to save memory for agent ${agentId}:`, err);
  }
}

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
        const memory = await fetchMemory(config, job.run.agentId);
        let seq = 0;
        const onProgress = (e: { kind: string; label: string; detail?: string }) =>
          postEvent(config, job.run.id, { seq: seq++, ...e }).catch(() => { /* best-effort */ });
        const outcome = await executeJob(job, config.localReposRoot, config.skillsDir, config.workflowsDir, memory, config.toolsEnabled, config.runEventsEnabled, onProgress);
        if (outcome.kind === 'gate') {
          await postResult(config, job.run.id, { gate: outcome.gate, sessionId: outcome.sessionId });
          console.log(`[runner] Run ${job.run.id} paused at gate "${outcome.gate.id}"`);
        } else {
          await postResult(config, job.run.id, { result: outcome.result, sessionId: outcome.sessionId, handoff: outcome.handoff });
          if (outcome.note) await postMemory(config, job.run.agentId, { runId: job.run.id, note: outcome.note });
          console.log(`[runner] Run ${job.run.id} completed`);
        }
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

async function postEvent(config: RunnerConfig, runId: string, body: { seq: number; kind: string; label: string; detail?: string }): Promise<void> {
  await fetch(`${config.orchestratorUrl}/api/runs/${runId}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-runner-token': config.runnerToken },
    body: JSON.stringify(body),
  });
}

async function postResult(
  config: RunnerConfig,
  runId: string,
  body: { result?: string; error?: string; gate?: unknown; sessionId?: string; handoff?: unknown },
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
