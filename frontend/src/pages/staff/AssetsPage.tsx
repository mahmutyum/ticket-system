import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { useAuthStore } from '../../stores/auth.store';
import { getApiError } from '../../utils/api-error';
import { PageHeader } from '../../components/ui/PageHeader';
import { StatusBadge } from '../../components/ui/Badge';
import type { Company } from '../../types';

export type Asset = {
  id: string;
  companyId: string;
  tag: string;
  name: string;
  assetType: string;
  serialNumber: string | null;
  locationId: string | null;
  assignedToEmail: string | null;
  notes: string | null;
  isActive: boolean;
  company: { name: string };
  location: { name: string } | null;
  _count: { tickets: number };
};

type AssetDetail = Asset & { tickets: Array<{ id: string; ticketNumber: string; subject: string; status: string; createdAt: string }> };

type FormState = {
  id: string | null; companyId: string; tag: string; name: string; assetType: string;
  serialNumber: string; locationId: string; assignedToEmail: string; notes: string; isActive: boolean;
};

const emptyForm = (companyId: string): FormState => ({
  id: null, companyId, tag: '', name: '', assetType: '', serialNumber: '', locationId: '', assignedToEmail: '', notes: '', isActive: true,
});

export default function AssetsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const role = useAuthStore(s => s.user?.role);
  const canEdit = role === 'admin' || role === 'it_manager';
  const [companyId, setCompanyId] = useState('');
  const [q, setQ] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ created: number; updated: number; errors: Array<{ line: number; message: string }> } | null>(null);

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ['companies-admin'],
    queryFn: async () => (await api.get('/companies/admin/all')).data.data,
    enabled: canEdit,
  });
  const { data: assets = [] } = useQuery<Asset[]>({
    queryKey: ['assets', companyId, q],
    queryFn: async () => (await api.get('/assets', { params: { ...(companyId ? { companyId } : {}), ...(q.trim().length >= 2 ? { q } : {}) } })).data.data,
  });
  const { data: locations = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['company-locations', form?.companyId],
    queryFn: async () => (await api.get(`/companies/${form!.companyId}/locations`)).data.data,
    enabled: !!form?.companyId,
  });
  const { data: detail } = useQuery<AssetDetail>({
    queryKey: ['asset', detailId],
    queryFn: async () => (await api.get(`/assets/${detailId}`)).data.data,
    enabled: !!detailId,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['assets'] });

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;
    try {
      const payload = { ...form, id: undefined, serialNumber: form.serialNumber || null, locationId: form.locationId || null, assignedToEmail: form.assignedToEmail || null, notes: form.notes || null };
      if (form.id) await api.put(`/assets/${form.id}`, payload);
      else await api.post('/assets', payload);
      await refresh();
      setForm(null);
      toast.success(t('assets.saved'));
    } catch (err) {
      toast.error(getApiError(err, t('assets.failed')));
    }
  };

  const remove = async (asset: Asset) => {
    try {
      await api.delete(`/assets/${asset.id}`);
      await refresh();
      toast.success(t('assets.deleted'));
    } catch (err) {
      toast.error(getApiError(err, t('assets.failed')));
    }
  };

  const importCsv = async (file: File) => {
    if (!companyId) {
      toast.error(t('assets.pickCompany'));
      return;
    }
    try {
      const res = await api.post('/assets/import', { companyId, csv: await file.text() });
      setImportResult(res.data.data);
      await refresh();
    } catch (err) {
      toast.error(getApiError(err, t('assets.failed')));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t('assets.eyebrow')} title={t('assets.title')} description={t('assets.description')} actions={canEdit ? (
        <div className="flex flex-wrap gap-2">
          <label className="btn-secondary flex cursor-pointer items-center gap-2" title={t('assets.importHint')}>
            <Upload className="h-4 w-4" /> {t('assets.import')}
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void importCsv(f); e.target.value = ''; }} />
          </label>
          <button className="btn-primary flex items-center gap-2" onClick={() => setForm(emptyForm(companyId || companies[0]?.id || ''))}>
            <Plus className="h-4 w-4" /> {t('assets.add')}
          </button>
        </div>
      ) : undefined} />

      {importResult && (
        <div className="card text-sm">
          <div className="flex items-start justify-between">
            <p>{t('assets.importResult', { created: importResult.created, updated: importResult.updated, errors: importResult.errors.length })}</p>
            <button className="icon-button border-0" aria-label={t('common.close')} onClick={() => setImportResult(null)}><X className="h-4 w-4" /></button>
          </div>
          {importResult.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-red-600">
              {importResult.errors.map(e => <li key={e.line}>{t('assets.importError', { line: e.line, message: e.message })}</li>)}
            </ul>
          )}
        </div>
      )}

      {form && (
        <form onSubmit={e => void save(e)} className="card grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="as-company">{t('assets.company')}</label>
            <select id="as-company" className="input-field" value={form.companyId} disabled={!!form.id} onChange={e => setForm({ ...form, companyId: e.target.value, locationId: '' })} required>
              <option value="">—</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {(['tag', 'name', 'assetType', 'serialNumber', 'assignedToEmail'] as const).map(key => (
            <div key={key}>
              <label className="mb-1 block text-xs font-medium" htmlFor={`as-${key}`}>{t(`assets.fields.${key}`)}</label>
              <input id={`as-${key}`} className="input-field" type={key === 'assignedToEmail' ? 'email' : 'text'}
                required={key === 'tag' || key === 'name' || key === 'assetType'}
                value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} />
            </div>
          ))}
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="as-location">{t('assets.fields.location')}</label>
            <select id="as-location" className="input-field" value={form.locationId} onChange={e => setForm({ ...form, locationId: e.target.value })}>
              <option value="">—</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium" htmlFor="as-notes">{t('assets.fields.notes')}</label>
            <input id="as-notes" className="input-field" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
          <label className="flex items-end gap-2 pb-2 text-xs">
            <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} /> {t('assets.active')}
          </label>
          <div className="flex justify-end gap-2 sm:col-span-3">
            <button type="button" className="btn-secondary" onClick={() => setForm(null)}>{t('common.cancel')}</button>
            <button type="submit" className="btn-primary">{t('common.save')}</button>
          </div>
        </form>
      )}

      <div className="card space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          {canEdit && (
            <select className="input-field sm:!w-56" value={companyId} onChange={e => setCompanyId(e.target.value)} aria-label={t('assets.company')}>
              <option value="">{t('assets.allCompanies')}</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input className="input-field pl-9" value={q} onChange={e => setQ(e.target.value)} placeholder={t('assets.search')} aria-label={t('assets.search')} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="py-2 pr-3">{t('assets.fields.tag')}</th>
                <th className="py-2 pr-3">{t('assets.fields.name')}</th>
                <th className="py-2 pr-3">{t('assets.fields.assignedToEmail')}</th>
                <th className="py-2 pr-3">{t('assets.fields.location')}</th>
                <th className="py-2 pr-3">{t('assets.ticketCount')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {assets.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-muted">{t('assets.empty')}</td></tr>}
              {assets.map(a => (
                <tr key={a.id} className={`border-t ${a.isActive ? '' : 'opacity-60'}`}>
                  <td className="py-2 pr-3 font-mono text-xs"><button type="button" className="hover:underline" onClick={() => setDetailId(a.id)}>{a.tag}</button></td>
                  <td className="py-2 pr-3">{a.name}<span className="block text-xs text-muted">{a.assetType} · {a.company.name}</span></td>
                  <td className="py-2 pr-3 text-xs">{a.assignedToEmail ?? '—'}</td>
                  <td className="py-2 pr-3 text-xs">{a.location?.name ?? '—'}</td>
                  <td className="py-2 pr-3 text-xs">{a._count.tickets}</td>
                  <td className="py-2 text-right">
                    {canEdit && (
                      <span className="inline-flex gap-1">
                        <button className="icon-button" aria-label={t('common.edit')} onClick={() => setForm({
                          id: a.id, companyId: a.companyId, tag: a.tag, name: a.name, assetType: a.assetType, serialNumber: a.serialNumber ?? '',
                          locationId: a.locationId ?? '', assignedToEmail: a.assignedToEmail ?? '', notes: a.notes ?? '', isActive: a.isActive,
                        })}><Pencil className="h-4 w-4" /></button>
                        <button className="icon-button" aria-label={t('common.delete')} onClick={() => void remove(a)}><Trash2 className="h-4 w-4 text-red-500" /></button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detail && detailId && (
        <div className="card space-y-3 text-sm">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-semibold"><span className="font-mono">{detail.tag}</span> — {detail.name}</h2>
              <p className="text-xs text-muted">{detail.assetType}{detail.serialNumber ? ` · SN ${detail.serialNumber}` : ''}{detail.notes ? ` · ${detail.notes}` : ''}</p>
            </div>
            <button className="icon-button border-0" aria-label={t('common.close')} onClick={() => setDetailId(null)}><X className="h-4 w-4" /></button>
          </div>
          <h3 className="text-xs font-semibold uppercase text-muted">{t('assets.history')}</h3>
          {detail.tickets.length === 0 && <p className="text-xs text-muted">{t('assets.noTickets')}</p>}
          <ul className="divide-y divide-gray-100 dark:divide-slate-800">
            {detail.tickets.map(tk => (
              <li key={tk.id} className="flex items-center justify-between gap-2 py-2">
                <Link to={`/staff/tickets/${tk.id}`} className="min-w-0 truncate hover:underline"><span className="font-mono text-xs">{tk.ticketNumber}</span> · {tk.subject}</Link>
                <StatusBadge status={tk.status} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
