import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Agent } from '../api/client.js';

export function useAgents() {
  return useQuery({ queryKey: ['agents'], queryFn: api.agents.list });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Agent>) => api.agents.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.agents.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useTriggerRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.runs.trigger(agentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs'] }),
  });
}
