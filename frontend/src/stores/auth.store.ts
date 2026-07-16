import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface StaffUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  department?: string;
  avatarUrl?: string;
  mfaEnabled?: boolean;
}

interface AuthState {
  accessToken: string | null;
  user: StaffUser | null;
  isAuthenticated: boolean;
  isHydrated: boolean;
  // Sunucu tarafı bayrağı: ayrıcalıklı hesaplara MFA uyarısı gösterilsin mi.
  mfaWarningEnabled: boolean;
  setAuth: (token: string, user: StaffUser) => void;
  setAccessToken: (token: string) => void;
  setUser: (user: StaffUser) => void;
  setMfaWarningEnabled: (val: boolean) => void;
  logout: () => void;
  setHydrated: (val: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isHydrated: false,
      mfaWarningEnabled: false,
      setAuth: (accessToken, user) =>
        set({ accessToken, user, isAuthenticated: true }),
      setAccessToken: (accessToken) =>
        set({ accessToken }),
      setUser: (user) =>
        set({ user }),
      setMfaWarningEnabled: (mfaWarningEnabled) =>
        set({ mfaWarningEnabled }),
      logout: () =>
        set({ accessToken: null, user: null, isAuthenticated: false }),
      setHydrated: (isHydrated) =>
        set({ isHydrated }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
      }),
    },
  ),
);
