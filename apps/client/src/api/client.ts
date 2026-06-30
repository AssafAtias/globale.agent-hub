const BASE = '';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface Agent {
  id: string; name: string; type: string; model: string; prompt: string;
  repos: string; triggerRules: string; outputs: string;
  enabled: boolean; createdAt: string;
  avatarKey?: string | null; title?: string | null; bio?: string | null;
  focus?: string | null;
  skills: string; // JSON: string[]
  sortOrder: number;
  archived: boolean;
  teamsTarget?: string | null;
}
export interface AgentInput {
  name: string; type: string; model: string; prompt: string;
  repos: string[]; triggerRules: { events: string[]; branchFilter?: string; jiraLabel?: string; cron?: string };
  outputs: string[]; enabled?: boolean;
  avatarKey?: string; title?: string; bio?: string; focus?: string; skills?: string[];
}
export interface MemoryEntry { id: string; runId: string | null; note: string; createdAt: string; }
export interface AgentMemory { focus: string | null; entries: MemoryEntry[]; }
export interface Run {
  id: string; agentId: string; trigger: string; status: string;
  result: string | null; error: string | null; createdAt: string; finishedAt: string | null;
  archived: boolean;
  sessionId?: string | null; pendingGate?: string | null;
  triggerPayload?: string | null;
}
export interface Runner {
  id: string; name: string; status: string; lastSeen: string;
}
export interface SkillSummary { name: string; description: string; }

export interface TeamsStatus {
  bot: { connected: boolean };
  webhook: { connected: boolean };
}

export interface RunEvent {
  seq: number;
  kind: string;
  label: string;
  detail?: string;
}

export const api = {
  agents: {
    list: (includeArchived = false) =>
      req<Agent[]>(`/api/agents${includeArchived ? '?includeArchived=true' : ''}`),
    get: (id: string) => req<Agent>(`/api/agents/${id}`),
    create: (body: Partial<AgentInput>) => req<Agent>('/api/agents', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Partial<AgentInput>) => req<Agent>(`/api/agents/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    setArchived: (id: string, archived: boolean) =>
      req<Agent>(`/api/agents/${id}`, { method: 'PATCH', body: JSON.stringify({ archived }) }),
    reorder: (ids: string[]) =>
      req<void>('/api/agents/reorder', { method: 'PATCH', body: JSON.stringify({ ids }) }),
    delete: (id: string) => req<void>(`/api/agents/${id}`, { method: 'DELETE' }),
    memory: {
      get: (id: string) => req<AgentMemory>(`/api/agents/${id}/memory`),
      append: (id: string, body: { runId?: string; note: string }) =>
        req<MemoryEntry>(`/api/agents/${id}/memory`, { method: 'POST', body: JSON.stringify(body) }),
      clear: (id: string) => req<void>(`/api/agents/${id}/memory`, { method: 'DELETE' }),
    },
  },
  runs: {
    list: () => req<Run[]>('/api/runs'),
    get: (id: string) => req<Run>(`/api/runs/${id}`),
    trigger: (agentId: string) => req<Run>('/api/runs', { method: 'POST', body: JSON.stringify({ agentId }) }),
    setArchived: (id: string, archived: boolean) =>
      req<Run>(`/api/runs/${id}`, { method: 'PATCH', body: JSON.stringify({ archived }) }),
    respond: (id: string, body: { decision: 'approve' | 'reject' | 'answer'; message?: string }) =>
      req<{ ok: boolean }>(`/api/runs/${id}/respond`, { method: 'POST', body: JSON.stringify(body) }),
    events: (id: string) => req<RunEvent[]>(`/api/runs/${id}/events`),
  },
  runners: {
    list: () => req<Runner[]>('/api/runners'),
  },
  skills: {
    list: () => req<SkillSummary[]>('/api/skills'),
  },
  integrations: {
    teams: () => req<TeamsStatus>('/api/integrations/teams'),
  },
};
