import axios from 'axios';
import { useAuthStore } from '../stores/auth.store';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const res = await axios.post('/api/auth/staff/refresh', {}, { withCredentials: true });
        const { accessToken } = res.data.data;
        useAuthStore.getState().setAccessToken(accessToken);
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch {
        useAuthStore.getState().logout();
        window.location.href = '/staff/login';
      }
    }

    return Promise.reject(error);
  },
);

export async function initializeAuth(): Promise<boolean> {
  const { setAccessToken, setUser, logout, setHydrated } = useAuthStore.getState();

  try {
    const res = await axios.post('/api/auth/staff/refresh', {}, { withCredentials: true });
    const { accessToken, user } = res.data.data || {};
    if (!accessToken) {
      logout();
      return false;
    }
    setAccessToken(accessToken);
    if (user) {
      setUser(user);
    }
    useAuthStore.setState({ isAuthenticated: true });
    return true;
  } catch {
    logout();
    return false;
  } finally {
    setHydrated(true);
  }
}

export default api;
