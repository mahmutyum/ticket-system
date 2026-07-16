import type { Dispatch, FormEventHandler, SetStateAction } from 'react';
import { Mail, Trash2 } from 'lucide-react';
import { GROUP_TYPES, type CompanyForm, type LocationForm, type SmtpForm } from './company-management';

type CompanyFormModalProps = {
  editId: string | null;
  form: CompanyForm;
  setForm: Dispatch<SetStateAction<CompanyForm>>;
  logoUploading: boolean;
  onLogoUpload: (file: File) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onClose: () => void;
};

export function CompanyFormModal({
  editId, form, setForm, logoUploading, onLogoUpload, onSubmit, onClose,
}: CompanyFormModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="glass-strong rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold mb-4">{editId ? 'Şirket Düzenle' : 'Yeni Şirket'}</h2>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Şirket Adı *</label>
            <input type="text" className="input-field" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Grup Türü *</label>
            <select className="input-field" value={form.groupType} onChange={(event) => setForm({ ...form, groupType: event.target.value })}>
              {GROUP_TYPES.map((group) => <option key={group.value} value={group.value}>{group.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">İzinli Email Domainleri</label>
            <input type="text" className="input-field" value={form.allowedDomains} onChange={(event) => setForm({ ...form, allowedDomains: event.target.value })} placeholder="company.com, company.com.tr" />
            <p className="text-xs text-gray-400 mt-1">Virgülle ayırın. Boş bırakırsanız tüm email domainlerine açık olur.</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Portal Domain Kilidi</label>
            <input type="text" className="input-field" value={form.portalDomains} onChange={(event) => setForm({ ...form, portalDomains: event.target.value })} placeholder="ticket.abc.com.tr" />
            <p className="text-xs text-gray-400 mt-1">Bu domainlerden erişildiğinde sadece bu şirket için ticket açılabilir. Boş bırakırsanız genel portaldan erişilir.</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">IT Grup Email (Bildirim)</label>
            <input type="email" className="input-field" value={form.notificationEmail} onChange={(event) => setForm({ ...form, notificationEmail: event.target.value })} placeholder="it-destek@company.com" />
            <p className="text-xs text-gray-400 mt-1">Yeni ticket açıldığında bu adrese bildirim gönderilir.</p>
          </div>
          <div className="border-t border-subtle pt-3 space-y-3">
            <h3 className="text-sm font-semibold text-muted uppercase tracking-wide">Marka</h3>
            <div>
              <label className="block text-sm font-medium mb-1">Ana Renk</label>
              <div className="flex items-center gap-2">
                <input type="color" className="w-12 h-10 rounded-lg border border-gray-300 dark:border-slate-600 dark:border-slate-700 bg-transparent cursor-pointer" value={form.primaryColor || '#2563eb'} onChange={(event) => setForm({ ...form, primaryColor: event.target.value })} />
                <input type="text" className="input-field flex-1 font-mono" value={form.primaryColor} onChange={(event) => setForm({ ...form, primaryColor: event.target.value })} placeholder="#2563eb" pattern="^#[0-9a-fA-F]{6}$" />
                {form.primaryColor && <button type="button" onClick={() => setForm({ ...form, primaryColor: '' })} className="text-xs text-muted hover:text-red-500" title="Sıfırla">Sıfırla</button>}
              </div>
              <p className="text-xs text-gray-400 mt-1">Portal sayfalarında bu renk uygulanır. Boş bırakırsanız varsayılan mavi kullanılır.</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Logo</label>
              <div className="flex items-center gap-3">
                {form.logo
                  ? <img src={form.logo} alt="Şirket logosu" className="w-14 h-14 object-contain rounded-lg border border-subtle bg-white p-1" />
                  : <div className="w-14 h-14 rounded-lg border border-dashed border-subtle flex items-center justify-center text-xs text-muted">Logo</div>}
                <div className="flex-1 space-y-2">
                  <input type="text" className="input-field" value={form.logo} onChange={(event) => setForm({ ...form, logo: event.target.value })} placeholder="URL veya dosya yükleyin" />
                  <label className={`btn-secondary text-xs inline-flex items-center gap-1 cursor-pointer ${logoUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                    {logoUploading ? 'Yükleniyor...' : 'Dosya Yükle'}
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" disabled={logoUploading} onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) onLogoUpload(file);
                      event.target.value = '';
                    }} />
                  </label>
                </div>
              </div>
              {!editId && <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Dosya yükleme için önce şirketi kaydetmelisiniz. Şimdilik URL girebilirsiniz.</p>}
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1">Kaydet</button>
            <button type="button" onClick={onClose} className="btn-secondary flex-1">İptal</button>
          </div>
        </form>
      </div>
    </div>
  );
}

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
