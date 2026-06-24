import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

export function useSkills() {
  return useQuery({ queryKey: ['skills'], queryFn: api.skills.list, staleTime: 5 * 60 * 1000 });
}
