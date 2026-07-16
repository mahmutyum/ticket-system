import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { useAuthStore } from '../../stores/auth.store';

type Session = { sid: string; current: boolean; expiresInSeconds: number };

export default function AccountPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
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

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Hesap ve güvenlik</h1>
      <section className="card p-6">
        <h2 className="font-semibold mb-4">Şifre değiştir</h2>
        <form onSubmit={changePassword} className="space-y-4">
          <label className="block text-sm">Mevcut şifre
            <input type="password" autoComplete="current-password" required value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)} className="input mt-1 w-full" />
          </label>
          <label className="block text-sm">Yeni şifre
            <input type="password" autoComplete="new-password" required minLength={12} value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)} className="input mt-1 w-full" />
          </label>
          <p className="text-xs text-muted">En az 12 karakter ve dört karakter sınıfından en az üçü.</p>
          <button disabled={busy} className="btn-primary">{busy ? 'Değiştiriliyor…' : 'Şifreyi değiştir'}</button>
        </form>
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
