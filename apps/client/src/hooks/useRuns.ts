import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

export function useRuns() {
  return useQuery({ queryKey: ['runs'], queryFn: api.runs.list, refetchInterval: 5000 });
}

export function useRun(id: string) {
  return useQuery({
    queryKey: ['runs', id],
    queryFn: () => api.runs.get(id),
    refetchInterval: (q) => q.state.data?.status === 'done' || q.state.data?.status === 'failed' ? false : 3000,
  });
}
