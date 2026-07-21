import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Edit2, Plus, RotateCcw, Tags, X, XCircle } from 'lucide-react';
import { FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { getApiError } from '../../utils/api-error';

type Category = {
  id: string;
  companyId: string | null;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  slaResponseMinutes: number | null;
  slaResolutionMinutes: number | null;
};

type FormState = {
  name: string;
  description: string;
  sortOrder: number;
  slaResponseMinutes: string;
  slaResolutionMinutes: string;
};

const emptyForm: FormState = {
  name: '', description: '', sortOrder: 0, slaResponseMinutes: '', slaResolutionMinutes: '',
};

const DEFAULT_CATEGORIES = [
  { name: 'Bilgisayar Donanım', slaResponseMinutes: 30, slaResolutionMinutes: 240 },
  { name: 'Yazılım / Uygulama', slaResponseMinutes: 30, slaResolutionMinutes: 180 },
  { name: 'İnternet / Ağ Bağlantısı', slaResponseMinutes: 15, slaResolutionMinutes: 120 },
  { name: 'E-posta / Outlook', slaResponseMinutes: 30, slaResolutionMinutes: 120 },
  { name: 'Yazıcı / Tarayıcı', slaResponseMinutes: 60, slaResolutionMinutes: 240 },
  { name: 'Yetki / Şifre Talebi', slaResponseMinutes: 15, slaResolutionMinutes: 60 },
  { name: 'Diğer', slaResponseMinutes: 60, slaResolutionMinutes: 480 },
] as const;

export function CategoryManagementModal({ companyId, companyName, onClose }: {
  companyId: string;
  companyName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const { data: categories = [], isLoading } = useQuery<Category[]>({
    queryKey: ['categories-admin', companyId],
    queryFn: async () => (await api.get(`/categories/admin?companyId=${companyId}`)).data.data,
  });

  const companyCategories = useMemo(
    () => categories.filter((category) => category.companyId === companyId),
    [categories, companyId],
  );
  const globalCategories = useMemo(
    () => categories.filter((category) => category.companyId === null && category.isActive),
    [categories],
  );

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['categories-admin', companyId] }),
      queryClient.invalidateQueries({ queryKey: ['categories'] }),
    ]);
  };

  const reset = () => { setEditId(null); setForm(emptyForm); };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    const payload = {
      companyId,
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      sortOrder: form.sortOrder,
      slaResponseMinutes: form.slaResponseMinutes ? Number(form.slaResponseMinutes) : undefined,
      slaResolutionMinutes: form.slaResolutionMinutes ? Number(form.slaResolutionMinutes) : undefined,
    };
    try {
      if (editId) await api.put(`/categories/${editId}`, payload);
      else await api.post('/categories', payload);
      toast.success(editId ? t('companyMgmt.category.toast.updated') : t('companyMgmt.category.toast.added'));
      reset();
      await refresh();
    } catch (error: unknown) {
      toast.error(getApiError(error, t('companyMgmt.category.toast.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (category: Category) => {
    try {
      if (category.isActive) await api.delete(`/categories/${category.id}`);
      else await api.put(`/categories/${category.id}`, { isActive: true });
      toast.success(category.isActive ? t('companyMgmt.category.toast.deactivated') : t('companyMgmt.category.toast.reactivated'));
      await refresh();
    } catch (error: unknown) {
      toast.error(getApiError(error, t('companyMgmt.category.toast.toggleFailed')));
    }
  };

  const addDefaults = async () => {
    const existing = new Set(companyCategories.map((category) => category.name.toLocaleLowerCase('tr')));
    const missing = DEFAULT_CATEGORIES.filter((category) => !existing.has(category.name.toLocaleLowerCase('tr')));
    if (!missing.length) {
      toast(t('companyMgmt.category.toast.allDefaultsExist'));
      return;
    }
    setSaving(true);
    try {
      await Promise.all(missing.map((category, index) => api.post('/categories', {
        companyId,
        ...category,
        sortOrder: companyCategories.length + index + 1,
      })));
      toast.success(t('companyMgmt.category.toast.defaultsAdded', { count: missing.length }));
      await refresh();
    } catch (error: unknown) {
      toast.error(getApiError(error, t('companyMgmt.category.toast.defaultsFailed')));
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (category: Category) => {
    setEditId(category.id);
    setForm({
      name: category.name,
      description: category.description || '',
      sortOrder: category.sortOrder,
      slaResponseMinutes: category.slaResponseMinutes?.toString() || '',
      slaResolutionMinutes: category.slaResolutionMinutes?.toString() || '',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t('companyMgmt.category.dialogLabel', { name: companyName })} className="card max-h-[92vh] w-full max-w-4xl overflow-y-auto !p-0" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-subtle px-6 py-5">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold"><Tags className="h-5 w-5 text-primary-500" /> {t('companyMgmt.category.title')}</h2>
            <p className="mt-1 text-sm text-muted">{t('companyMgmt.category.subtitle', { name: companyName })}</p>
          </div>
          <button className="icon-button border-0" onClick={onClose} aria-label={t('common.close')}><X className="h-5 w-5" /></button>
        </div>

        <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">{t('companyMgmt.category.companySpecific')}</h3>
                <p className="text-xs text-muted">{t('companyMgmt.category.deactivateHint')}</p>
              </div>
              <button type="button" onClick={addDefaults} disabled={saving} className="btn-secondary flex items-center gap-2 text-sm">
                <Plus className="h-4 w-4" /> {t('companyMgmt.category.addDefaults')}
              </button>
            </div>

            {isLoading ? <p className="text-sm text-muted">{t('companyMgmt.category.loading')}</p> : companyCategories.length === 0 ? (
              <div className="sub-surface px-4 py-8 text-center text-sm text-muted">{t('companyMgmt.category.empty')}</div>
            ) : (
              <div className="divide-y divide-gray-200 overflow-hidden rounded-inset border border-subtle dark:divide-slate-800">
                {companyCategories.map((category) => (
                  <div key={category.id} className={`flex items-center gap-3 px-4 py-3 ${category.isActive ? '' : 'opacity-55'}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{category.name}</span>
                        {!category.isActive && <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-700 dark:bg-slate-700 dark:text-slate-200">{t('common.inactive')}</span>}
                      </div>
                      <p className="mt-0.5 text-xs text-muted">
                        {t('companyMgmt.category.metaLine', { order: category.sortOrder, response: category.slaResponseMinutes || '—', resolution: category.slaResolutionMinutes || '—' })}
                      </p>
                    </div>
                    <button type="button" onClick={() => startEdit(category)} className="icon-button border-0" aria-label={t('companyMgmt.category.editAria', { name: category.name })}><Edit2 className="h-4 w-4" /></button>
                    <button type="button" onClick={() => toggleActive(category)} className={`icon-button border-0 ${category.isActive ? 'text-red-500' : 'text-green-600'}`} aria-label={category.isActive ? t('companyMgmt.category.deactivateAria', { name: category.name }) : t('companyMgmt.category.activateAria', { name: category.name })}>
                      {category.isActive ? <XCircle className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div>
              <h3 className="font-semibold">{t('companyMgmt.category.globalDefaults')}</h3>
              <p className="mb-2 text-xs text-muted">{t('companyMgmt.category.globalHint')}</p>
              <div className="flex flex-wrap gap-2">
                {globalCategories.map((category) => <span key={category.id} className="surface-2 rounded-full px-3 py-1 text-xs">{category.name}</span>)}
              </div>
            </div>
          </div>

          <form onSubmit={submit} className="sub-surface h-fit space-y-3 p-4">
            <h3 className="font-semibold">{editId ? t('companyMgmt.category.editForm') : t('companyMgmt.category.newForm')}</h3>
            <label className="block text-sm">{t('companyMgmt.category.name')}
              <input className="input-field mt-1" maxLength={120} required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <label className="block text-sm">{t('common.description')}
              <textarea className="input-field mt-1 min-h-20" maxLength={500} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
            </label>
            <label className="block text-sm">{t('companyMgmt.category.sortOrder')}
              <input type="number" className="input-field mt-1" value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) })} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-sm">{t('companyMgmt.category.responseSla')}
                <input type="number" min={1} className="input-field mt-1" value={form.slaResponseMinutes} onChange={(event) => setForm({ ...form, slaResponseMinutes: event.target.value })} />
              </label>
              <label className="block text-sm">{t('companyMgmt.category.resolutionSla')}
                <input type="number" min={1} className="input-field mt-1" value={form.slaResolutionMinutes} onChange={(event) => setForm({ ...form, slaResolutionMinutes: event.target.value })} />
              </label>
            </div>
            <div className="flex gap-2 pt-1">
              <button className="btn-primary flex-1" disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button>
              {editId && <button type="button" className="btn-secondary" onClick={reset}>{t('common.cancel')}</button>}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
