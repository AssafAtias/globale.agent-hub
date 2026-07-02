import { create } from 'zustand';
import type { User } from '../api/client.js';

interface AuthState {
  me: User | null;
  loading: boolean;
  setMe: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>(set => ({
  me: null,
  loading: true,
  setMe: user => set({ me: user, loading: false }),
  setLoading: loading => set({ loading }),
}));
