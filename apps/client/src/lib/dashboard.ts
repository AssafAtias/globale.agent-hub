import type { Run, Agent } from '../api/client.js';
import type { WorkerState } from '../components/dashboard/palette.js';

const ACTIVE = new Set(['pending', 'running']);
const byCreatedDesc = (a: Run, b: Run): number => b.createdAt.localeCompare(a.createdAt);

export interface DashboardStats {
  activeAgents: number;
  tasksQueued: number;
  mrsToday: number;
  avgCycle: string;
  liveCount: number;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatCycle(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds >= 3600) return `${Math.round(seconds / 3600)}h`;
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds)}s`;
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const diff = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)}m`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h`;
  return `${Math.round(diff / 86400)}d`;
}

export function computeDashboardStats(runs: Run[], _agents: Agent[], now: Date = new Date()): DashboardStats {
  const live = runs.filter((r) => !r.archived && ACTIVE.has(r.status));
  const running = live.filter((r) => r.status === 'running');
  const activeAgentIds = new Set(running.map((r) => r.agentId));

  const tasksQueued = live.filter((r) => r.status === 'pending').length;

  const mrsToday = runs.filter(
    (r) => !r.archived && r.status === 'done' && r.finishedAt && sameDay(new Date(r.finishedAt), now)
  ).length;

  const finished = runs.filter((r) => !r.archived && r.finishedAt);
  const avgSeconds =
    finished.length === 0
      ? null
      : finished.reduce(
          (sum, r) => sum + (new Date(r.finishedAt!).getTime() - new Date(r.createdAt).getTime()) / 1000,
          0
        ) / finished.length;

  return {
    activeAgents: activeAgentIds.size,
    tasksQueued,
    mrsToday,
    avgCycle: formatCycle(avgSeconds),
    liveCount: activeAgentIds.size,
  };
}

export interface WorkerCard {
  agent: Agent;
  state: WorkerState;
  latest: Run | null;
}

function isReviewer(agent: Agent): boolean {
  return /review/i.test(agent.type) || /review/i.test(agent.name);
}

function stateFor(agent: Agent, latest: Run | null): WorkerState {
  if (!latest) return 'idle';
  switch (latest.status) {
    case 'running':
      return isReviewer(agent) ? 'reviewing' : 'working';
    case 'pending':
      return 'queued';
    case 'failed':
      return 'blocked';
    default:
      return 'idle';
  }
}

export function buildWorkerCards(agents: Agent[], runs: Run[]): WorkerCard[] {
  return agents
    .filter((a) => !a.archived)
    .map((agent) => {
      const own = runs.filter((r) => r.agentId === agent.id && !r.archived).sort(byCreatedDesc);
      const latest = own[0] ?? null;
      return { agent, state: stateFor(agent, latest), latest };
    });
}
