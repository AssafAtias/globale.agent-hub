import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

export function useRunEvents(id: string, status: string | undefined) {
  const isTerminal = status === 'done' || status === 'failed';
  return useQuery({
    queryKey: ['runEvents', id],
    queryFn: () => api.runs.events(id),
    enabled: !!id,
    refetchInterval: isTerminal ? false : 2000,
  });
}
