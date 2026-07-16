import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { useAuthStore } from '../../stores/auth.store';
import { PageHeader } from '../../components/ui/PageHeader';

type Session = { sid: string; current: boolean; expiresInSeconds: number };

export default function AccountPage() {
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
    toast.success(`${response.data.data.revoked} diğer oturum kapatıldı`);
    await loadSessions();
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post('/auth/staff/change-password', { currentPassword, newPassword });
      logout();
      toast.success('Şifre değiştirildi. Yeniden giriş yapın.');
      navigate('/staff/login');
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { error?: string } } }).response?.data?.error;
      toast.error(message || 'Şifre değiştirilemedi');
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
    toast.success('İki aşamalı doğrulama etkinleştirildi');
    setMfaSetup(null);
    setMfaCode('');
  };

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader eyebrow="Kişisel güvenlik" title="Hesap ve güvenlik" description="Parolanı, iki aşamalı doğrulamayı ve aktif oturumlarını yönet." />
      <section className="card p-6">
        <h2 className="font-semibold mb-4">Şifre değiştir</h2>
        <form onSubmit={changePassword} className="space-y-4">
          <label className="block text-sm">Mevcut şifre
            <input type="password" autoComplete="current-password" required value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)} className="input-field mt-1 w-full" />
          </label>
          <label className="block text-sm">Yeni şifre
            <input type="password" autoComplete="new-password" required minLength={12} value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)} className="input-field mt-1 w-full" />
          </label>
          <p className="text-xs text-muted">En az 12 karakter ve dört karakter sınıfından en az üçü.</p>
          <button disabled={busy} className="btn-primary">{busy ? 'Değiştiriliyor…' : 'Şifreyi değiştir'}</button>
        </form>
      </section>
      <section className="card p-6 space-y-4">
        <div><h2 className="font-semibold">İki aşamalı doğrulama</h2><p className="text-sm text-muted">Authenticator uygulamasıyla hesabınıza ikinci koruma katmanı ekleyin.</p></div>
        {!mfaSetup ? <button onClick={startMfa} className="btn-secondary">MFA kurulumu başlat</button> : <div className="space-y-3">
          <p className="text-sm">Aşağıdaki anahtarı authenticator uygulamanıza ekleyin:</p>
          <code className="block break-all rounded bg-gray-100 dark:bg-slate-800 p-3 select-all">{mfaSetup.secret}</code>
          <a className="text-sm text-primary-600 underline" href={mfaSetup.uri}>Authenticator uygulamasında aç</a>
          <label className="block text-sm">Üretilen 6 haneli kod
            <input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, ''))} className="input mt-1 w-full" />
          </label>
          <button onClick={enableMfa} disabled={mfaCode.length !== 6} className="btn-primary">Etkinleştir</button>
        </div>}
      </section>
      <section className="card p-6">
        <div className="flex items-center justify-between gap-4">
          <div><h2 className="font-semibold">Aktif oturumlar</h2><p className="text-sm text-muted">{sessions.length} oturum açık</p></div>
          <button onClick={revokeOthers} className="btn-secondary">Diğer cihazları kapat</button>
        </div>
      </section>
    </div>
  );
}
