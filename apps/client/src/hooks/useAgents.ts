import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Agent, type AgentInput } from '../api/client.js';

export function useAgents(includeArchived = false) {
  return useQuery({
    queryKey: ['agents', { includeArchived }],
    queryFn: () => api.agents.list(includeArchived),
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<AgentInput>) => api.agents.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.agents.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
    onError: (err) => console.error('Failed to delete agent:', err),
  });
}

export function useArchiveAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      api.agents.setArchived(id, archived),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
    onError: (err) => console.error('Failed to archive agent:', err),
  });
}

export function useReorderAgents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.agents.reorder(ids),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: ['agents'] });
      const previous = qc.getQueriesData<Agent[]>({ queryKey: ['agents'] });
      qc.setQueriesData<Agent[]>({ queryKey: ['agents'] }, (old) => {
        if (!old) return old;
        const byId = new Map(old.map((a) => [a.id, a]));
        const reordered = ids.map((id) => byId.get(id)).filter((a): a is Agent => !!a);
        const rest = old.filter((a) => !ids.includes(a.id));
        return [...reordered, ...rest];
      });
      return { previous };
    },
    onError: (_err, _ids, ctx) => {
      ctx?.previous?.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useTriggerRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.runs.trigger(agentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs'] }),
  });
}
