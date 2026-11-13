import axios from 'axios';
import i18n from '../i18n/config';
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
  // Backend API mesajlarını (hata yanıtları) aktif dile göre döndürsün.
  config.headers['Accept-Language'] = i18n.language?.startsWith('tr') ? 'tr' : 'en';
  return config;
});

// 401 sonrası refresh TEK UÇUŞLU: eşzamanlı istekler aynı refresh çağrısını
// bekler. Eskiden her 401 kendi refresh'ini ateşliyordu — refresh rotation
// (her çağrıda cookie yenilenir) yüzünden paralel refresh'lerden ilki başarıp
// diğerleri başarısız olur, ikinci istekler doğru token'ı kaçırırdı.
let refreshInFlight: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const res = await axios.post('/api/auth/staff/refresh', {}, { withCredentials: true });
  const { accessToken } = res.data.data || {};
  if (!accessToken) throw new Error('refresh başarısız: access token yok');
  useAuthStore.getState().setAccessToken(accessToken);
  return accessToken;
}

/** Oturumu kapatır ve login'e yönlendirir; bulunduğu sayfayı `next` ile taşır. */
function redirectToLogin(): void {
  useAuthStore.getState().logout();
  const { pathname, search } = window.location;
  const current = pathname + search;
  // Login sayfasının kendisi (ve sso parametreleri) `next` olamaz — döngü üretir.
  // `//` ile başlayan değer protokol-göreceli dış adres olur — dış yönlendirme yasak.
  const returnable = current.startsWith('/staff') && !current.startsWith('/staff/login');
  const safe = returnable && !current.startsWith('//') ? `?next=${encodeURIComponent(current)}` : '';
  window.location.href = `/staff/login${safe}`;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        refreshInFlight ??= refreshAccessToken().finally(() => {
          refreshInFlight = null;
        });
        const accessToken = await refreshInFlight;
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch {
        redirectToLogin();
      }
    }

    return Promise.reject(error);
  },
);

export async function initializeAuth(): Promise<boolean> {
  const { setAccessToken, setUser, logout, setHydrated } = useAuthStore.getState();

  try {
    const res = await axios.post('/api/auth/staff/refresh', {}, { withCredentials: true });
    const { accessToken, user, mfaWarningEnabled } = res.data.data || {};
    if (!accessToken) {
      logout();
      return false;
    }
    setAccessToken(accessToken);
    if (user) {
      setUser(user);
    }
    if (typeof mfaWarningEnabled === 'boolean') {
      useAuthStore.getState().setMfaWarningEnabled(mfaWarningEnabled);
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
