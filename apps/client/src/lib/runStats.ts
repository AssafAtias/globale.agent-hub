import type { Run, Agent } from '../api/client.js';

export interface AgentHealth {
  agent: Agent;
  total: number;
  done: number;
  failed: number;
  running: number;
  successRate: number | null;
  lastRunAt: string | null;
  lastStatus: string | null;
}

export interface FeedFilter {
  agentId?: string;
  status?: string;
  showArchived?: boolean;
}

const ACTIVE = new Set(['pending', 'running']);

const byCreatedDesc = (a: Run, b: Run): number => b.createdAt.localeCompare(a.createdAt);

export function selectActiveRuns(runs: Run[]): Run[] {
  return runs.filter((r) => !r.archived && ACTIVE.has(r.status)).sort(byCreatedDesc);
}

export function computeAgentHealth(runs: Run[], agents: Agent[]): AgentHealth[] {
  return agents.map((agent) => {
    const own = runs.filter((r) => r.agentId === agent.id && !r.archived).sort(byCreatedDesc);
    const done = own.filter((r) => r.status === 'done').length;
    const failed = own.filter((r) => r.status === 'failed').length;
    const running = own.filter((r) => ACTIVE.has(r.status)).length;
    const finished = done + failed;
    return {
      agent,
      total: own.length,
      done,
      failed,
      running,
      successRate: finished === 0 ? null : done / finished,
      lastRunAt: own.length > 0 ? own[0].createdAt : null,
      lastStatus: own.length > 0 ? own[0].status : null,
    };
  });
}

export function recentRunMarkers(runs: Run[], agentId: string, n: number): string[] {
  const own = runs
    .filter((r) => r.agentId === agentId && !r.archived)
    .sort(byCreatedDesc) // newest first
    .slice(0, n) // most recent n
    .map((r) => r.status);
  return own.reverse(); // oldest -> newest
}

export function filterFeed(runs: Run[], filter: FeedFilter): Run[] {
  return runs
    .filter((r) => (filter.showArchived ? true : !r.archived))
    .filter((r) => (filter.agentId ? r.agentId === filter.agentId : true))
    .filter((r) => (filter.status ? r.status === filter.status : true))
    .sort(byCreatedDesc);
}
