import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Building, Headset, KeyRound, LogIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../stores/auth.store';
import { initializeAuth } from '../../api/client';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';

type SsoProvider = { slug: string; name: string; type: 'oidc' | 'saml' | 'ldap' };
type SsoInfo = { providers: SsoProvider[]; localLoginDisabled: boolean };

const inputClass = 'input-field bg-gray-700 border-gray-600 text-white placeholder-gray-400 dark:bg-gray-700 dark:border-gray-600';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  /** Seçili LDAP sağlayıcısı: form kullanıcı adı + parolaya döner. */
  const [ldap, setLdap] = useState<SsoProvider | null>(null);
  const [showLocal, setShowLocal] = useState(false);
  const [completingSso, setCompletingSso] = useState(false);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useTranslation();
  const setAuth = useAuthStore(s => s.setAuth);
  const ssoHandled = useRef(false);

  const { data: sso } = useQuery<SsoInfo>({
    queryKey: ['sso-providers'],
    queryFn: async () => (await axios.get('/api/auth/sso/providers')).data.data,
    staleTime: 60_000,
  });

  // OIDC/SAML dönüşü: sunucu refresh cookie'sini set etti; oturumu refresh ile al.
  // (Access token URL'e hiç yazılmaz.)
  useEffect(() => {
    if (ssoHandled.current) return;
    const ok = searchParams.get('sso') === 'ok';
    const error = searchParams.get('sso_error');
    if (!ok && !error) return;
    ssoHandled.current = true;
    setSearchParams({}, { replace: true });
    if (error) {
      toast.error(t(`auth.ssoErrors.${error}`, { defaultValue: t('auth.ssoErrors.session') }));
      return;
    }
    setCompletingSso(true);
    void initializeAuth().then((success) => {
      setCompletingSso(false);
      if (success) navigate('/staff');
      else toast.error(t('auth.ssoErrors.session'));
    });
  }, [searchParams, setSearchParams, navigate, t]);

  const finishLogin = (data: { accessToken: string; user: { fullName: string } & Parameters<typeof setAuth>[1]; mfaWarningEnabled?: boolean }) => {
    setAuth(data.accessToken, data.user);
    if (typeof data.mfaWarningEnabled === 'boolean') {
      useAuthStore.getState().setMfaWarningEnabled(data.mfaWarningEnabled);
    }
    toast.success(t('auth.welcome', { name: data.user.fullName }));
    navigate('/staff');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = ldap
        ? await axios.post(`/api/auth/sso/${ldap.slug}/login`, { username: email, password })
        : mfaChallenge
          ? await axios.post('/api/auth/staff/mfa/verify-login', { challenge: mfaChallenge, code: mfaCode })
          : await axios.post('/api/auth/staff/login', { email, password });
      if (res.data.data.mfaRequired) {
        setMfaChallenge(res.data.data.challenge);
        toast.success(t('auth.mfaPrompt'));
        return;
      }
      finishLogin(res.data.data);
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { error?: string } } }).response?.data?.error;
      toast.error(message || t('auth.loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  const redirectProviders = sso?.providers.filter(p => p.type !== 'ldap') ?? [];
  const ldapProviders = sso?.providers.filter(p => p.type === 'ldap') ?? [];
  // Yerel giriş kapalıysa form yalnızca "yönetici girişi" ile açılır (acil durum hesabı).
  const localHidden = !!sso?.localLoginDisabled && !showLocal && !ldap && !mfaChallenge;

  if (completingSso) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center text-gray-300">{t('auth.ssoCompleting')}</div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-end mb-3">
          <LanguageSwitcher />
        </div>
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-600 rounded-inset mb-4">
            <Headset className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">{t('auth.title')}</h1>
          <p className="text-gray-400 text-sm mt-1">{t('auth.subtitle')}</p>
        </div>

        <div className="bg-gray-800 rounded-surface p-6 space-y-4">
          {!ldap && !mfaChallenge && (redirectProviders.length > 0 || ldapProviders.length > 0) && (
            <div className="space-y-2">
              {redirectProviders.map(p => (
                <a key={p.slug} href={`/api/auth/sso/${p.slug}/start`}
                  className="flex w-full items-center justify-center gap-2 rounded-control border border-gray-600 bg-gray-700 py-2.5 text-sm font-medium text-white hover:bg-gray-600">
                  <Building className="h-4 w-4" /> {t('auth.ssoWith', { name: p.name })}
                </a>
              ))}
              {ldapProviders.map(p => (
                <button key={p.slug} type="button" onClick={() => { setLdap(p); setEmail(''); setPassword(''); }}
                  className="flex w-full items-center justify-center gap-2 rounded-control border border-gray-600 bg-gray-700 py-2.5 text-sm font-medium text-white hover:bg-gray-600">
                  <KeyRound className="h-4 w-4" /> {t('auth.ldapLogin', { name: p.name })}
                </button>
              ))}
              {!localHidden && (
                <div className="flex items-center gap-3 pt-1 text-xs text-gray-500">
                  <span className="h-px flex-1 bg-gray-700" />{t('auth.or')}<span className="h-px flex-1 bg-gray-700" />
                </div>
              )}
            </div>
          )}

          {localHidden ? (
            <button type="button" onClick={() => setShowLocal(true)} className="w-full text-center text-xs text-gray-400 hover:text-gray-200">
              {t('auth.localAdminLogin')}
            </button>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {ldap && <p className="text-sm font-medium text-gray-200">{t('auth.ldapLogin', { name: ldap.name })}</p>}
              {!mfaChallenge && <><div>
                <label htmlFor="staff-email" className="block text-sm font-medium text-gray-300 mb-1">{ldap ? t('auth.ldapUsername') : t('auth.email')}</label>
                <input
                  id="staff-email"
                  type={ldap ? 'text' : 'email'}
                  autoComplete="username"
                  className={inputClass}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={ldap ? 'ayse.yilmaz' : 'email@company.com'}
                  required
                />
              </div>
              <div>
                <label htmlFor="staff-password" className="block text-sm font-medium text-gray-300 mb-1">{t('auth.password')}</label>
                <input
                  id="staff-password"
                  type="password"
                  autoComplete="current-password"
                  className={inputClass}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div></>}
              {mfaChallenge && <div>
                <label htmlFor="staff-mfa-code" className="block text-sm font-medium text-gray-300 mb-1">{t('auth.mfaCode')}</label>
                <input id="staff-mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
                  className="w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-control text-white tracking-[0.35em] text-center"
                  value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, ''))} required autoFocus />
              </div>}
              <button
                type="submit"
                disabled={loading}
                className="w-full btn-primary py-2.5 flex items-center justify-center gap-2"
              >
                <LogIn className="w-4 h-4" />
                {loading ? t('auth.loggingIn') : mfaChallenge ? t('auth.mfaVerify') : t('auth.login')}
              </button>
              {ldap && (
                <button type="button" onClick={() => setLdap(null)} className="w-full text-center text-xs text-gray-400 hover:text-gray-200">
                  {t('auth.backToOptions')}
                </button>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
