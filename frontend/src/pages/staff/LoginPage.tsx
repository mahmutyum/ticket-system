import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Headset, LogIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../stores/auth.store';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const navigate = useNavigate();
  const { t } = useTranslation();
  const setAuth = useAuthStore(s => s.setAuth);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = mfaChallenge
        ? await axios.post('/api/auth/staff/mfa/verify-login', { challenge: mfaChallenge, code: mfaCode })
        : await axios.post('/api/auth/staff/login', { email, password });
      if (res.data.data.mfaRequired) {
        setMfaChallenge(res.data.data.challenge);
        toast.success(t('auth.mfaPrompt'));
        return;
      }
      const { accessToken, user, mfaWarningEnabled } = res.data.data;
      setAuth(accessToken, user);
      if (typeof mfaWarningEnabled === 'boolean') {
        useAuthStore.getState().setMfaWarningEnabled(mfaWarningEnabled);
      }
      toast.success(t('auth.welcome', { name: user.fullName }));
      navigate('/staff');
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { error?: string } } }).response?.data?.error;
      toast.error(message || t('auth.loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-end mb-3">
          <LanguageSwitcher />
        </div>
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-600 rounded-2xl mb-4">
            <Headset className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">{t('auth.title')}</h1>
          <p className="text-gray-400 text-sm mt-1">{t('auth.subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-gray-800 rounded-xl p-6 space-y-4">
          {!mfaChallenge && <><div>
            <label htmlFor="staff-email" className="block text-sm font-medium text-gray-300 mb-1">{t('auth.email')}</label>
            <input
              id="staff-email"
              type="email"
              className="w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="email@company.com"
              required
            />
          </div>
          <div>
            <label htmlFor="staff-password" className="block text-sm font-medium text-gray-300 mb-1">{t('auth.password')}</label>
            <input
              id="staff-password"
              type="password"
              className="w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div></>}
          {mfaChallenge && <div>
            <label htmlFor="staff-mfa-code" className="block text-sm font-medium text-gray-300 mb-1">{t('auth.mfaCode')}</label>
            <input id="staff-mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
              className="w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white tracking-[0.35em] text-center"
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
        </form>
      </div>
    </div>
  );
}
