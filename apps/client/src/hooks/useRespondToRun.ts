import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

export function useRespondToRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; decision: 'approve' | 'reject' | 'answer'; message?: string }) =>
      api.runs.respond(v.id, { decision: v.decision, message: v.message }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs'] }),
  });
}
