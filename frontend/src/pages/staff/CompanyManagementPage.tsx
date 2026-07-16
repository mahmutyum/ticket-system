import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, MapPin, Building2, Mail, Trash2, CheckCircle2, XCircle, Tags } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { getApiError } from '../../utils/api-error';
import { useEnumLabels } from '../../i18n/labels';
import type { Company, Location } from '../../types';
import {
  companyPayload, companyToForm, emptyCompanyForm, emptyLocationForm,
  emptySmtpForm,
} from './company-management';
import { CompanyFormModal, LocationFormModal, SmtpConfigModal } from './CompanyManagementModals';
import { PageHeader } from '../../components/ui/PageHeader';
import { CategoryManagementModal } from './CategoryManagementModal';

export default function CompanyManagementPage() {
  const { t } = useTranslation();
  const labels = useEnumLabels();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyCompanyForm);
  const [logoUploading, setLogoUploading] = useState(false);
  const [categoryCompany, setCategoryCompany] = useState<{ id: string; name: string } | null>(null);

  // Location form
  const [showLocForm, setShowLocForm] = useState(false);
  const [locCompanyId, setLocCompanyId] = useState('');
  const [locEditId, setLocEditId] = useState<string | null>(null);
  const [locForm, setLocForm] = useState(emptyLocationForm);

  // SMTP form
  const [showSmtpForm, setShowSmtpForm] = useState(false);
  const [smtpCompanyId, setSmtpCompanyId] = useState('');
  const [smtpCompanyName, setSmtpCompanyName] = useState('');
  const [smtpForm, setSmtpForm] = useState(emptySmtpForm);
  const [smtpTesting, setSmtpTesting] = useState(false);

  const { data: companies } = useQuery<Company[]>({
    queryKey: ['companies-admin'],
    queryFn: async () => (await api.get('/companies/admin/all')).data.data,
  });

  const handleSubmitCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = companyPayload(form);
      if (editId) {
        await api.put(`/companies/${editId}`, payload);
        toast.success(t('companyMgmt.toast.companyUpdated'));
      } else {
        await api.post('/companies', payload);
        toast.success(t('companyMgmt.toast.companyAdded'));
      }
      queryClient.invalidateQueries({ queryKey: ['companies-admin'] });
      setShowForm(false);
      setEditId(null);
      setForm(emptyCompanyForm);
    } catch (err: unknown) {
      toast.error(getApiError(err, t('common.error')));
    }
  };

  const handleLogoUpload = async (file: File) => {
    if (!editId) {
      toast.error(t('companyMgmt.toast.saveCompanyFirst'));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t('companyMgmt.toast.fileTooLarge'));
      return;
    }
    setLogoUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post(`/companies/${editId}/logo`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const url = res.data?.data?.logo as string;
      if (url) {
        setForm(prev => ({ ...prev, logo: url }));
        toast.success(t('companyMgmt.toast.logoUploaded'));
        queryClient.invalidateQueries({ queryKey: ['companies-admin'] });
      }
    } catch (err: unknown) {
      toast.error(getApiError(err, t('companyMgmt.toast.logoUploadFailed')));
    } finally {
      setLogoUploading(false);
    }
  };

  const handleSubmitLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (locEditId) {
        await api.put(`/locations/${locEditId}`, locForm);
        toast.success(t('companyMgmt.toast.locationUpdated'));
      } else {
        await api.post('/locations', { companyId: locCompanyId, ...locForm });
        toast.success(t('companyMgmt.toast.locationAdded'));
      }
      queryClient.invalidateQueries({ queryKey: ['companies-admin'] });
      setShowLocForm(false);
      setLocEditId(null);
      setLocForm(emptyLocationForm);
    } catch (err: unknown) {
      toast.error(getApiError(err, t('common.error')));
    }
  };

  const openEditLocation = (loc: Location) => {
    setLocEditId(loc.id);
    setLocCompanyId(loc.companyId);
    setLocForm({
      name: loc.name || '',
      address: loc.address || '',
      phone: loc.phone || '',
      floor: loc.floor || '',
      itRoom: loc.itRoom || '',
    });
    setShowLocForm(true);
  };

  const handleDeleteLocation = async (loc: Location) => {
    if (!confirm(t('companyMgmt.confirm.deleteLocation', { name: loc.name }))) return;
    try {
      await api.delete(`/locations/${loc.id}`);
      toast.success(t('companyMgmt.toast.locationDeleted'));
      queryClient.invalidateQueries({ queryKey: ['companies-admin'] });
    } catch (err: unknown) {
      toast.error(getApiError(err, t('companyMgmt.toast.deleteFailed')));
    }
  };

  // SMTP handlers
  const openSmtpForm = async (companyId: string, companyName: string) => {
    setSmtpCompanyId(companyId);
    setSmtpCompanyName(companyName);
    try {
      const res = await api.get(`/companies/${companyId}/smtp`);
      if (res.data.data) {
        const s = res.data.data;
        setSmtpForm({ host: s.host, port: s.port, secure: s.secure, user: s.user, pass: '', fromName: s.fromName, fromEmail: s.fromEmail, isActive: s.isActive });
      } else {
        setSmtpForm(emptySmtpForm);
      }
    } catch {
      setSmtpForm(emptySmtpForm);
    }
    setShowSmtpForm(true);
  };

  const handleTestSmtp = async () => {
    if (!smtpForm.host || !smtpForm.user || !smtpForm.pass) {
      toast.error(t('companyMgmt.toast.smtpAllFields'));
      return;
    }
    setSmtpTesting(true);
    try {
      await api.post(`/companies/${smtpCompanyId}/smtp/test`, smtpForm);
      toast.success(t('companyMgmt.toast.smtpTestSuccess'));
    } catch (err: unknown) {
      toast.error(getApiError(err, t('companyMgmt.toast.smtpTestFailed')));
    } finally {
      setSmtpTesting(false);
    }
  };

  const handleSaveSmtp = async () => {
    if (!smtpForm.host || !smtpForm.user || !smtpForm.fromEmail) {
      toast.error(t('companyMgmt.toast.fillRequired'));
      return;
    }
    try {
      await api.put(`/companies/${smtpCompanyId}/smtp`, smtpForm);
      toast.success(t('companyMgmt.toast.smtpSaved'));
      queryClient.invalidateQueries({ queryKey: ['companies-admin'] });
      setShowSmtpForm(false);
    } catch (err: unknown) {
      toast.error(getApiError(err, t('companyMgmt.toast.saveFailed')));
    }
  };

  const handleToggleCompanyActive = async (company: Company) => {
    const willDeactivate = company.isActive !== false;
    const msg = willDeactivate
      ? t('companyMgmt.confirm.deactivateCompany', { name: company.name })
      : t('companyMgmt.confirm.reactivateCompany', { name: company.name });
    if (!confirm(msg)) return;
    try {
      if (willDeactivate) {
        await api.delete(`/companies/${company.id}`);
        toast.success(t('companyMgmt.toast.companyDeactivated'));
      } else {
        await api.post(`/companies/${company.id}/restore`);
        toast.success(t('companyMgmt.toast.companyReactivated'));
      }
      queryClient.invalidateQueries({ queryKey: ['companies-admin'] });
    } catch (err: unknown) {
      toast.error(getApiError(err, t('common.operationFailed')));
    }
  };

  const handleDeleteSmtp = async () => {
    if (!confirm(t('companyMgmt.confirm.deleteSmtp'))) return;
    try {
      await api.delete(`/companies/${smtpCompanyId}/smtp`);
      toast.success(t('companyMgmt.toast.smtpDeleted'));
      queryClient.invalidateQueries({ queryKey: ['companies-admin'] });
      setShowSmtpForm(false);
    } catch {
      toast.error(t('companyMgmt.toast.deleteFailedGeneric'));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={t('companyMgmt.header.eyebrow')} title={t('companyMgmt.header.title')} description={t('companyMgmt.header.description')} actions={
        <button onClick={() => { setShowForm(true); setEditId(null); setForm(emptyCompanyForm); }} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> {t('companyMgmt.newCompany')}
        </button>
      } />

      {/* Company Form Modal */}
      {showForm && (
        <CompanyFormModal
          editId={editId}
          form={form}
          setForm={setForm}
          logoUploading={logoUploading}
          onLogoUpload={handleLogoUpload}
          onSubmit={handleSubmitCompany}
          onClose={() => setShowForm(false)}
        />
      )}

      {/* Location Form Modal */}
      {showLocForm && (
        <LocationFormModal
          editId={locEditId}
          form={locForm}
          setForm={setLocForm}
          onSubmit={handleSubmitLocation}
          onClose={() => { setShowLocForm(false); setLocEditId(null); }}
        />
      )}

      {/* SMTP Config Modal */}
      {showSmtpForm && (
        <SmtpConfigModal
          companyName={smtpCompanyName}
          form={smtpForm}
          setForm={setSmtpForm}
          testing={smtpTesting}
          onTest={handleTestSmtp}
          onDelete={handleDeleteSmtp}
          onSave={handleSaveSmtp}
          onClose={() => setShowSmtpForm(false)}
        />
      )}

      {categoryCompany && (
        <CategoryManagementModal
          companyId={categoryCompany.id}
          companyName={categoryCompany.name}
          onClose={() => setCategoryCompany(null)}
        />
      )}

      {/* Companies list */}
      <div className="space-y-4">
        {companies?.map(company => (
          <div key={company.id} className="card">
            <div className="flex flex-col gap-3 mb-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <Building2 className="w-5 h-5 text-primary-500" />
                <div>
                  <h3 className="font-semibold">{company.name}</h3>
                  <span className="text-xs text-gray-400">
                    {labels.groupType(company.groupType)} •
                    {' '}{t('companyMgmt.list.locationsCount', { count: company._count?.locations ?? 0 })} •
                    {' '}{t('companyMgmt.list.ticketsCount', { count: company._count?.tickets ?? 0 })}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setCategoryCompany({ id: company.id, name: company.name })}
                  className="btn-secondary flex items-center gap-1 text-xs"
                >
                  <Tags className="h-3 w-3" /> {t('companyMgmt.categories')}
                </button>
                <button
                  onClick={() => openSmtpForm(company.id, company.name)}
                  className={`btn-secondary text-xs flex items-center gap-1 ${company.smtpConfig ? 'ring-1 ring-green-300' : ''}`}
                  title={company.smtpConfig ? t('companyMgmt.smtp.configured') : t('companyMgmt.smtp.configure')}
                >
                  <Mail className="w-3 h-3" />
                  {company.smtpConfig ? (
                    <span className="flex items-center gap-1">
                      SMTP <CheckCircle2 className="w-3 h-3 text-green-500" />
                    </span>
                  ) : 'SMTP'}
                </button>
                <button
                  onClick={() => { setLocCompanyId(company.id); setLocEditId(null); setShowLocForm(true); setLocForm(emptyLocationForm); }}
                  className="btn-secondary text-xs flex items-center gap-1"
                >
                  <MapPin className="w-3 h-3" /> {t('companyMgmt.addLocation')}
                </button>
                <button
                  onClick={() => { setEditId(company.id); setForm(companyToForm(company)); setShowForm(true); }}
                  className="p-1.5 hover:bg-gray-100 rounded"
                  title={t('common.edit')}
                >
                  <Edit2 className="w-4 h-4 text-gray-500" />
                </button>
                <button
                  onClick={() => handleToggleCompanyActive(company)}
                  className="p-1.5 hover:bg-red-50 rounded"
                  title={company.isActive === false ? t('companyMgmt.reactivate') : t('companyMgmt.deactivate')}
                >
                  {company.isActive === false
                    ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                    : <XCircle className="w-4 h-4 text-red-500" />}
                </button>
              </div>
            </div>
            {company.isActive === false && (
              <div className="mb-2 text-xs bg-red-50 text-red-700 px-3 py-1.5 rounded-lg inline-block">
                {t('companyMgmt.list.inactiveBanner')}
              </div>
            )}

            {/* Domain restriction badges */}
            {company.allowedDomains && (company.allowedDomains as string[]).length > 0 && (
              <div className="mb-2 text-xs bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg">
                {t('companyMgmt.list.emailRestriction', { domains: (company.allowedDomains as string[]).join(', ') })}
              </div>
            )}
            {company.portalDomains && (company.portalDomains as string[]).length > 0 && (
              <div className="mb-2 text-xs bg-purple-50 text-purple-700 px-3 py-1.5 rounded-lg">
                {t('companyMgmt.list.portalLock', { domains: (company.portalDomains as string[]).join(', ') })}
              </div>
            )}

            {company.notificationEmail && (
              <div className="mb-2 text-xs bg-amber-50 text-amber-700 px-3 py-1.5 rounded-lg">
                {t('companyMgmt.list.itGroupEmail', { email: company.notificationEmail })}
              </div>
            )}

            {/* SMTP Status Badge */}
            {company.smtpConfig && (
              <div className="mb-2 flex items-center gap-2 text-xs bg-green-50 text-green-700 px-3 py-1.5 rounded-lg">
                <Mail className="w-3 h-3" />
                <span>{t('companyMgmt.list.customSmtp', { fromName: company.smtpConfig.fromName, fromEmail: company.smtpConfig.fromEmail, host: company.smtpConfig.host, port: company.smtpConfig.port })}</span>
                {!company.smtpConfig.isActive && <span className="text-orange-600">{t('companyMgmt.list.inactiveParen')}</span>}
              </div>
            )}

            {(company.locations?.length ?? 0) > 0 && (
              <div className="ml-8 space-y-1">
                {company.locations?.map(loc => (
                  <div key={loc.id} className="flex items-center gap-2 text-sm text-gray-600 dark:text-slate-400 group">
                    <MapPin className="w-3 h-3 text-gray-400" />
                    <span>{loc.name}</span>
                    {loc.address && <span className="text-gray-400">— {loc.address}</span>}
                    {loc.floor && <span className="text-gray-400">• {t('companyMgmt.list.floor', { floor: loc.floor })}</span>}
                    {loc.itRoom && <span className="text-gray-400">• {loc.itRoom}</span>}
                    <div className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => openEditLocation(loc)}
                        className="p-1 hover:bg-gray-100 rounded"
                        title={t('common.edit')}
                      >
                        <Edit2 className="w-3 h-3 text-gray-500" />
                      </button>
                      <button
                        onClick={() => handleDeleteLocation(loc)}
                        className="p-1 hover:bg-red-50 rounded"
                        title={t('common.delete')}
                      >
                        <Trash2 className="w-3 h-3 text-red-500" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
