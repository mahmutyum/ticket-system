import type { Dispatch, FormEventHandler, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Mail, Trash2 } from 'lucide-react';
import { useEnumLabels } from '../../i18n/labels';
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
  const { t } = useTranslation();
  const labels = useEnumLabels();
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="glass-strong rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold mb-4">{editId ? t('companyMgmt.editCompany') : t('companyMgmt.newCompany')}</h2>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">{t('companyMgmt.form.companyName')}</label>
            <input type="text" className="input-field" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('companyMgmt.form.groupType')}</label>
            <select className="input-field" value={form.groupType} onChange={(event) => setForm({ ...form, groupType: event.target.value })}>
              {GROUP_TYPES.map((group) => <option key={group} value={group}>{labels.groupType(group)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('companyMgmt.form.allowedDomains')}</label>
            <input type="text" className="input-field" value={form.allowedDomains} onChange={(event) => setForm({ ...form, allowedDomains: event.target.value })} placeholder="company.com, company.com.tr" />
            <p className="text-xs text-gray-400 mt-1">{t('companyMgmt.form.allowedDomainsHint')}</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('companyMgmt.form.portalDomains')}</label>
            <input type="text" className="input-field" value={form.portalDomains} onChange={(event) => setForm({ ...form, portalDomains: event.target.value })} placeholder="ticket.abc.com.tr" />
            <p className="text-xs text-gray-400 mt-1">{t('companyMgmt.form.portalDomainsHint')}</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('companyMgmt.form.notificationEmail')}</label>
            <input type="email" className="input-field" value={form.notificationEmail} onChange={(event) => setForm({ ...form, notificationEmail: event.target.value })} placeholder="it-destek@company.com" />
            <p className="text-xs text-gray-400 mt-1">{t('companyMgmt.form.notificationEmailHint')}</p>
          </div>
          <div className="border-t border-subtle pt-3 space-y-3">
            <h3 className="text-sm font-semibold text-muted uppercase tracking-wide">{t('companyMgmt.form.brand')}</h3>
            <div>
              <label className="block text-sm font-medium mb-1">{t('companyMgmt.form.primaryColor')}</label>
              <div className="flex items-center gap-2">
                <input type="color" className="w-12 h-10 rounded-lg border border-gray-300 dark:border-slate-600 dark:border-slate-700 bg-transparent cursor-pointer" value={form.primaryColor || '#2563eb'} onChange={(event) => setForm({ ...form, primaryColor: event.target.value })} />
                <input type="text" className="input-field flex-1 font-mono" value={form.primaryColor} onChange={(event) => setForm({ ...form, primaryColor: event.target.value })} placeholder="#2563eb" pattern="^#[0-9a-fA-F]{6}$" />
                {form.primaryColor && <button type="button" onClick={() => setForm({ ...form, primaryColor: '' })} className="text-xs text-muted hover:text-red-500" title={t('companyMgmt.form.reset')}>{t('companyMgmt.form.reset')}</button>}
              </div>
              <p className="text-xs text-gray-400 mt-1">{t('companyMgmt.form.primaryColorHint')}</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('companyMgmt.form.logo')}</label>
              <div className="flex items-center gap-3">
                {form.logo
                  ? <img src={form.logo} alt={t('companyMgmt.form.logoAlt')} className="w-14 h-14 object-contain rounded-lg border border-subtle bg-white p-1" />
                  : <div className="w-14 h-14 rounded-lg border border-dashed border-subtle flex items-center justify-center text-xs text-muted">{t('companyMgmt.form.logo')}</div>}
                <div className="flex-1 space-y-2">
                  <input type="text" className="input-field" value={form.logo} onChange={(event) => setForm({ ...form, logo: event.target.value })} placeholder={t('companyMgmt.form.logoInputPlaceholder')} />
                  <label className={`btn-secondary text-xs inline-flex items-center gap-1 cursor-pointer ${logoUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                    {logoUploading ? t('common.loading') : t('companyMgmt.form.uploadFile')}
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" disabled={logoUploading} onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) onLogoUpload(file);
                      event.target.value = '';
                    }} />
                  </label>
                </div>
              </div>
              {!editId && <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">{t('companyMgmt.form.uploadHint')}</p>}
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1">{t('common.save')}</button>
            <button type="button" onClick={onClose} className="btn-secondary flex-1">{t('common.cancel')}</button>
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
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="glass-strong rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold mb-4">{editId ? t('companyMgmt.editLocation') : t('companyMgmt.newLocation')}</h2>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">{t('companyMgmt.location.name')}</label>
            <input type="text" className="input-field" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('companyMgmt.location.address')}</label>
            <input type="text" className="input-field" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">{t('common.phone')}</label>
              <input type="tel" className="input-field" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('companyMgmt.location.floor')}</label>
              <input type="text" className="input-field" value={form.floor} onChange={(event) => setForm({ ...form, floor: event.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('companyMgmt.location.itRoom')}</label>
              <input type="text" className="input-field" value={form.itRoom} onChange={(event) => setForm({ ...form, itRoom: event.target.value })} />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1">{editId ? t('common.update') : t('common.add')}</button>
            <button type="button" onClick={onClose} className="btn-secondary flex-1">{t('common.cancel')}</button>
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
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="glass-strong rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
          <Mail className="w-5 h-5" /> {t('companyMgmt.smtp.title', { name: companyName })}
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          {t('companyMgmt.smtp.intro')}
        </p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">{t('companyMgmt.smtp.host')}</label>
              <input type="text" className="input-field" value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} placeholder="smtp.company.com" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-sm font-medium mb-1">{t('companyMgmt.smtp.port')}</label>
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
              <label className="block text-sm font-medium mb-1">{t('companyMgmt.smtp.user')}</label>
              <input type="text" className="input-field" value={form.user} onChange={(event) => setForm({ ...form, user: event.target.value })} placeholder="noreply@company.com" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('companyMgmt.smtp.password')}</label>
              <input type="password" className="input-field" value={form.pass} onChange={(event) => setForm({ ...form, pass: event.target.value })} placeholder="••••••••" autoComplete="new-password" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">{t('companyMgmt.smtp.fromName')}</label>
              <input type="text" className="input-field" value={form.fromName} onChange={(event) => setForm({ ...form, fromName: event.target.value })} placeholder="ABC IT Destek" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('companyMgmt.smtp.fromEmail')}</label>
              <input type="email" className="input-field" value={form.fromEmail} onChange={(event) => setForm({ ...form, fromEmail: event.target.value })} placeholder="it@company.com" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} className="rounded" />
            {t('companyMgmt.smtp.activeLabel')}
          </label>
          <div className="flex gap-2 pt-3 border-t">
            <button type="button" onClick={onTest} disabled={testing} className="btn-secondary flex items-center gap-2 text-sm">
              {testing ? t('companyMgmt.smtp.testing') : t('companyMgmt.smtp.testConnection')}
            </button>
            <div className="flex-1" />
            <button type="button" onClick={onDelete} className="btn-danger text-sm flex items-center gap-1">
              <Trash2 className="w-3 h-3" /> {t('companyMgmt.smtp.remove')}
            </button>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onSave} className="btn-primary flex-1">{t('common.save')}</button>
            <button type="button" onClick={onClose} className="btn-secondary flex-1">{t('common.cancel')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
