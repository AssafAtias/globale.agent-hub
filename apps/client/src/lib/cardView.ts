import type { Run, Agent } from '../api/client.js';
import type { WorkerState } from '../components/dashboard/palette.js';
import { computeAgentHealth, recentRunMarkers, type AgentHealth } from './runStats.js';
import { buildWorkerCards } from './dashboard.js';

export const MARKER_COUNT = 10;

export interface AgentCardModel {
  health: AgentHealth;
  state: WorkerState;
  markers: string[];
  latest: Run | null;
}

export type StatusFilter = 'all' | 'running' | 'idle';

export function isRunningState(state: WorkerState): boolean {
  return state === 'working' || state === 'reviewing' || state === 'queued';
}

export function matchesStatusFilter(state: WorkerState, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'running') return isRunningState(state);
  return !isRunningState(state); // 'idle' bucket: idle + blocked
}

export function summarizeTrigger(triggerRulesJson: string | null | undefined): string {
  let rules: { events?: string[]; jiraLabel?: string } = {};
  try { rules = JSON.parse(triggerRulesJson || '') ?? {}; } catch { return 'manual'; }
  if (rules.jiraLabel) return 'on Jira label';
  if (rules.events && rules.events.length > 0) return `on ${rules.events[0]}`;
  return 'manual';
}

export function buildAgentCardModels(agents: Agent[], runs: Run[]): Map<string, AgentCardModel> {
  const healthById = new Map(computeAgentHealth(runs, agents).map((h) => [h.agent.id, h]));
  const cardById = new Map(buildWorkerCards(agents, runs).map((c) => [c.agent.id, c]));
  const models = new Map<string, AgentCardModel>();
  for (const agent of agents) {
    const card = cardById.get(agent.id);
    models.set(agent.id, {
      health: healthById.get(agent.id)!,
      state: card?.state ?? 'idle',
      latest: card?.latest ?? null,
      markers: recentRunMarkers(runs, agent.id, MARKER_COUNT),
    });
  }
  return models;
}
