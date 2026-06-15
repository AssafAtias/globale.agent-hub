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
}
export interface Run {
  id: string; agentId: string; trigger: string; status: string;
  result: string | null; error: string | null; createdAt: string; finishedAt: string | null;
}
export interface Runner {
  id: string; name: string; status: string; lastSeen: string;
}

export const api = {
  agents: {
    list: () => req<Agent[]>('/api/agents'),
    get: (id: string) => req<Agent>(`/api/agents/${id}`),
    create: (body: Partial<Agent>) => req<Agent>('/api/agents', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Partial<Agent>) => req<Agent>(`/api/agents/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id: string) => req<void>(`/api/agents/${id}`, { method: 'DELETE' }),
  },
  runs: {
    list: () => req<Run[]>('/api/runs'),
    get: (id: string) => req<Run>(`/api/runs/${id}`),
    trigger: (agentId: string) => req<Run>('/api/runs', { method: 'POST', body: JSON.stringify({ agentId }) }),
  },
  runners: {
    list: () => req<Runner[]>('/api/runners'),
  },
};
