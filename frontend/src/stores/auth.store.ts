import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface StaffUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  department?: string;
  avatarUrl?: string;
}

interface AuthState {
  accessToken: string | null;
  user: StaffUser | null;
  isAuthenticated: boolean;
  setAuth: (token: string, user: StaffUser) => void;
  setAccessToken: (token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      setAuth: (accessToken, user) =>
        set({ accessToken, user, isAuthenticated: true }),
      setAccessToken: (accessToken) =>
        set({ accessToken }),
      logout: () =>
        set({ accessToken: null, user: null, isAuthenticated: false }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        accessToken: state.accessToken,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
