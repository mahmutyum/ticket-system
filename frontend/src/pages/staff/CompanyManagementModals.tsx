import type { Dispatch, FormEventHandler, SetStateAction } from 'react';
import { Mail, Trash2 } from 'lucide-react';
import type { LocationForm, SmtpForm } from './company-management';

type LocationFormModalProps = {
  editId: string | null;
  form: LocationForm;
  setForm: Dispatch<SetStateAction<LocationForm>>;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onClose: () => void;
};

export function LocationFormModal({
  editId,
  form,
  setForm,
  onSubmit,
  onClose,
}: LocationFormModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="glass-strong rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold mb-4">{editId ? 'Lokasyon Düzenle' : 'Yeni Lokasyon'}</h2>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Lokasyon Adı *</label>
            <input type="text" className="input-field" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Adres</label>
            <input type="text" className="input-field" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Telefon</label>
              <input type="tel" className="input-field" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Kat</label>
              <input type="text" className="input-field" value={form.floor} onChange={(event) => setForm({ ...form, floor: event.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">IT Odası</label>
              <input type="text" className="input-field" value={form.itRoom} onChange={(event) => setForm({ ...form, itRoom: event.target.value })} />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1">{editId ? 'Güncelle' : 'Ekle'}</button>
            <button type="button" onClick={onClose} className="btn-secondary flex-1">İptal</button>
          </div>
        </form>
      </div>
    </div>
  );
}

type SmtpConfigModalProps = {
  companyName: string;
  form: SmtpForm;
  setForm: Dispatch<SetStateAction<SmtpForm>>;
  testing: boolean;
  onTest: () => void;
  onDelete: () => void;
  onSave: () => void;
  onClose: () => void;
};

export function SmtpConfigModal({
  companyName, form, setForm, testing, onTest, onDelete, onSave, onClose,
}: SmtpConfigModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="glass-strong rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
          <Mail className="w-5 h-5" /> SMTP Ayarları — {companyName}
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          Boş bırakılırsa global SMTP ayarları kullanılır. Her şirket kendi SMTP sunucusuyla email gönderebilir.
        </p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">SMTP Sunucu *</label>
              <input type="text" className="input-field" value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} placeholder="smtp.company.com" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-sm font-medium mb-1">Port</label>
                <input type="number" className="input-field" value={form.port} onChange={(event) => setForm({ ...form, port: Number.parseInt(event.target.value, 10) || 587 })} />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.secure} onChange={(event) => setForm({ ...form, secure: event.target.checked })} className="rounded" /> SSL/TLS
                </label>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Kullanıcı *</label>
              <input type="text" className="input-field" value={form.user} onChange={(event) => setForm({ ...form, user: event.target.value })} placeholder="noreply@company.com" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Şifre *</label>
              <input type="password" className="input-field" value={form.pass} onChange={(event) => setForm({ ...form, pass: event.target.value })} placeholder="••••••••" autoComplete="new-password" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Gönderen Adı *</label>
              <input type="text" className="input-field" value={form.fromName} onChange={(event) => setForm({ ...form, fromName: event.target.value })} placeholder="ABC IT Destek" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Gönderen Email *</label>
              <input type="email" className="input-field" value={form.fromEmail} onChange={(event) => setForm({ ...form, fromEmail: event.target.value })} placeholder="it@company.com" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} className="rounded" />
            Aktif (pasifse global SMTP kullanılır)
          </label>
          <div className="flex gap-2 pt-3 border-t">
            <button type="button" onClick={onTest} disabled={testing} className="btn-secondary flex items-center gap-2 text-sm">
              {testing ? 'Test ediliyor...' : 'Bağlantı Test Et'}
            </button>
            <div className="flex-1" />
            <button type="button" onClick={onDelete} className="btn-danger text-sm flex items-center gap-1">
              <Trash2 className="w-3 h-3" /> Kaldır
            </button>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onSave} className="btn-primary flex-1">Kaydet</button>
            <button type="button" onClick={onClose} className="btn-secondary flex-1">İptal</button>
          </div>
        </div>
      </div>
    </div>
  );
}
