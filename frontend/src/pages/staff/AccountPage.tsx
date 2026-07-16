import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { useAuthStore } from '../../stores/auth.store';
import { PageHeader } from '../../components/ui/PageHeader';

type Session = { sid: string; current: boolean; expiresInSeconds: number };

export default function AccountPage() {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();

  const loadSessions = async () => {
    const response = await api.get('/auth/staff/sessions');
    setSessions(response.data.data);
  };

  useEffect(() => { void loadSessions(); }, []);

  const revokeOthers = async () => {
    const response = await api.delete('/auth/staff/sessions/others');
    toast.success(t('account.sessionsRevoked', { count: response.data.data.revoked }));
    await loadSessions();
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post('/auth/staff/change-password', { currentPassword, newPassword });
      logout();
      toast.success(t('account.passwordChanged'));
      navigate('/staff/login');
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { error?: string } } }).response?.data?.error;
      toast.error(message || t('account.passwordChangeFailed'));
    } finally {
      setBusy(false);
    }
  };

  const startMfa = async () => {
    const response = await api.post('/auth/staff/mfa/setup');
    setMfaSetup(response.data.data);
  };

  const enableMfa = async () => {
    await api.post('/auth/staff/mfa/enable', { code: mfaCode });
    toast.success(t('account.mfaEnabled'));
    setMfaSetup(null);
    setMfaCode('');
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t('account.eyebrow')} title={t('account.title')} description={t('account.headerDescription')} />
      <div className="grid gap-6 xl:grid-cols-2">
      <section className="card p-6">
        <h2 className="font-semibold mb-4">{t('account.passwordHeading')}</h2>
        <form onSubmit={changePassword} className="space-y-4">
          <label className="block text-sm">{t('account.currentPassword')}
            <input type="password" autoComplete="current-password" required value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)} className="input-field mt-1 w-full" />
          </label>
          <label className="block text-sm">{t('account.newPassword')}
            <input type="password" autoComplete="new-password" required minLength={12} value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)} className="input-field mt-1 w-full" />
          </label>
          <p className="text-xs text-muted">{t('account.passwordHint')}</p>
          <button disabled={busy} className="btn-primary">{busy ? t('account.changing') : t('account.changePassword')}</button>
        </form>
      </section>
      <section className="card p-6 space-y-4">
        <div><h2 className="font-semibold">{t('account.mfaHeading')}</h2><p className="text-sm text-muted">{t('account.mfaDescription')}</p></div>
        {!mfaSetup ? <button onClick={startMfa} className="btn-secondary">{t('account.startMfa')}</button> : <div className="space-y-3">
          <p className="text-sm">{t('account.mfaAddKey')}</p>
          <code className="block break-all rounded bg-gray-100 dark:bg-slate-800 p-3 select-all">{mfaSetup.secret}</code>
          <a className="text-sm text-primary-600 underline" href={mfaSetup.uri}>{t('account.openInAuthenticator')}</a>
          <label className="block text-sm">{t('account.mfaCodeLabel')}
            <input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, ''))} className="input-field mt-1 w-full" />
          </label>
          <button onClick={enableMfa} disabled={mfaCode.length !== 6} className="btn-primary">{t('account.enable')}</button>
        </div>}
      </section>
      <section className="card p-6 xl:col-span-2">
        <div className="flex items-center justify-between gap-4">
          <div><h2 className="font-semibold">{t('account.sessionsHeading')}</h2><p className="text-sm text-muted">{t('account.sessionsOpen', { count: sessions.length })}</p></div>
          <button onClick={revokeOthers} className="btn-secondary">{t('account.revokeOthers')}</button>
        </div>
      </section>
      </div>
    </div>
  );
}
