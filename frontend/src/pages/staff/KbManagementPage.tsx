import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { qk } from '../../api/query-keys';
import { useAuthStore } from '../../stores/auth.store';
import { getApiError } from '../../utils/api-error';
import { ErrorState } from '../../components/ui/AsyncState';
import { PageHeader } from '../../components/ui/PageHeader';
import Markdown from '../../components/Markdown';
import type { Company } from '../../types';

type Article = {
  id: string;
  companyId: string | null;
  categoryId: string | null;
  titleTr: string;
  bodyTr: string;
  titleEn: string | null;
  bodyEn: string | null;
  isPublished: boolean;
  viewCount: number;
  helpfulYes: number;
  helpfulNo: number;
  deflections: number;
  company: { name: string } | null;
  category: { name: string } | null;
};

type FormState = {
  id: string | null;
  companyId: string;
  categoryId: string;
  titleTr: string;
  bodyTr: string;
  titleEn: string;
  bodyEn: string;
  isPublished: boolean;
};

const emptyForm: FormState = { id: null, companyId: '', categoryId: '', titleTr: '', bodyTr: '', titleEn: '', bodyEn: '', isPublished: false };

export default function KbManagementPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const role = useAuthStore(s => s.user?.role);
  const canEdit = role === 'admin' || role === 'it_manager';
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<FormState | null>(null);
  const [lang, setLang] = useState<'tr' | 'en'>('tr');
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const pageSize = 20;

  // /kb artık sayfalı ({ data, pagination }); sayfa değişince eski liste
  // ekranda kalır (keepPreviousData) — listede zıplama olmaz.
  const { data, isError: kbLoadFailed, refetch: refetchKb } = useQuery({
    queryKey: ['kb-admin', q, page],
    placeholderData: keepPreviousData,
    queryFn: async () =>
      (await api.get('/kb', {
        params: { page, limit: pageSize, ...(q.trim().length >= 2 ? { q } : {}) },
      })).data as { data: Article[]; pagination: { page: number; limit: number; total: number; totalPages: number } },
  });
  const articles = data?.data ?? [];
  const pagination = data?.pagination;
  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: qk.companies.admin,
    queryFn: async () => (await api.get('/companies/admin/all')).data.data,
    enabled: canEdit,
  });
  const { data: categories = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: qk.categories.forCompany(form?.companyId),
    queryFn: async () => (await api.get(`/companies/${form!.companyId}/categories`)).data.data,
    enabled: !!form?.companyId,
  });

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      const payload = {
        companyId: form.companyId || null,
        categoryId: form.categoryId || null,
        titleTr: form.titleTr,
        bodyTr: form.bodyTr,
        titleEn: form.titleEn || null,
        bodyEn: form.bodyEn || null,
        isPublished: form.isPublished,
      };
      if (form.id) await api.put(`/kb/${form.id}`, payload);
      else await api.post('/kb', payload);
      await queryClient.invalidateQueries({ queryKey: ['kb-admin'] });
      setForm(null);
      toast.success(t('kb.staff.saved'));
    } catch (err) {
      toast.error(getApiError(err, t('kb.staff.failed')));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (article: Article) => {
    try {
      await api.delete(`/kb/${article.id}`);
      await queryClient.invalidateQueries({ queryKey: ['kb-admin'] });
      toast.success(t('kb.staff.deleted'));
    } catch (err) {
      toast.error(getApiError(err, t('kb.staff.failed')));
    }
  };

  const titleKey = lang === 'tr' ? 'titleTr' : 'titleEn';
  const bodyKey = lang === 'tr' ? 'bodyTr' : 'bodyEn';

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t('kb.staff.eyebrow')} title={t('kb.staff.title')} description={t('kb.staff.description')} actions={canEdit ? (
        <button className="btn-primary flex items-center gap-2" onClick={() => { setForm({ ...emptyForm }); setLang('tr'); setPreview(false); }}>
          <Plus className="h-4 w-4" /> {t('kb.staff.new')}
        </button>
      ) : undefined} />

      {form && (
        <form onSubmit={e => void save(e)} className="card space-y-4 text-sm">
          <h2 className="font-semibold">{form.id ? t('kb.staff.edit') : t('kb.staff.new')}</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="kb-company">{t('kb.staff.company')}</label>
              <select id="kb-company" className="input-field" value={form.companyId} onChange={e => setForm({ ...form, companyId: e.target.value, categoryId: '' })}>
                {role === 'admin' && <option value="">{t('kb.staff.allCompanies')}</option>}
                {role !== 'admin' && !form.companyId && <option value="">—</option>}
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="kb-category">{t('kb.staff.category')}</label>
              <select id="kb-category" className="input-field" value={form.categoryId} disabled={!form.companyId} onChange={e => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">{t('kb.staff.noCategory')}</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={form.isPublished} onChange={e => setForm({ ...form, isPublished: e.target.checked })} /> {t('kb.staff.published')}
            </label>
          </div>

          <div className="flex items-center gap-2 border-b border-subtle">
            {(['tr', 'en'] as const).map(l => (
              <button key={l} type="button" onClick={() => setLang(l)}
                className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-semibold uppercase ${lang === l ? 'border-primary-600 text-primary-600' : 'border-transparent text-muted'}`}>
                {l}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={preview} onChange={e => setPreview(e.target.checked)} /> {t('kb.staff.preview')}
            </label>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="kb-title">{t(`kb.staff.${titleKey}`)}</label>
            <input id="kb-title" className="input-field" required={lang === 'tr'} minLength={lang === 'tr' ? 3 : undefined} maxLength={200}
              value={form[titleKey]} onChange={e => setForm({ ...form, [titleKey]: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="kb-body">{t(`kb.staff.${bodyKey}`)}</label>
            {preview ? (
              <div className="min-h-[240px] rounded-inset border border-subtle p-3"><Markdown>{form[bodyKey] || '—'}</Markdown></div>
            ) : (
              <textarea id="kb-body" className="input-field min-h-[240px] font-mono text-xs" required={lang === 'tr'} maxLength={50_000}
                value={form[bodyKey]} onChange={e => setForm({ ...form, [bodyKey]: e.target.value })} />
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setForm(null)}>{t('common.cancel')}</button>
            <button type="submit" className="btn-primary" disabled={saving || !form.titleTr || !form.bodyTr}>{saving ? t('common.saving') : t('common.save')}</button>
          </div>
        </form>
      )}

      <div className="card space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input className="input-field pl-9" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder={t('kb.staff.search')} aria-label={t('kb.staff.search')} />
        </div>
        {kbLoadFailed ? (
          <ErrorState title={t('common.loadError')} retryLabel={t('common.retry')} onRetry={() => void refetchKb()} />
        ) : articles.length === 0 && <p className="text-sm text-muted">{t('kb.staff.empty')}</p>}
        <ul className="divide-y divide-gray-100 dark:divide-slate-800">
          {articles.map(a => (
            <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {a.titleTr}
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${a.isPublished ? 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' : 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300'}`}>
                    {a.isPublished ? t('kb.staff.published') : t('kb.staff.draft')}
                  </span>
                </p>
                <p className="text-xs text-muted">
                  {a.company?.name ?? t('kb.staff.allCompanies')}{a.category ? ` · ${a.category.name}` : ''} · {t('kb.staff.stats', { views: a.viewCount, yes: a.helpfulYes, no: a.helpfulNo, deflections: a.deflections })}
                </p>
              </div>
              {canEdit && (
                <div className="flex gap-1">
                  <button className="icon-button" aria-label={t('common.edit')}
                    onClick={() => { setForm({ id: a.id, companyId: a.companyId ?? '', categoryId: a.categoryId ?? '', titleTr: a.titleTr, bodyTr: a.bodyTr, titleEn: a.titleEn ?? '', bodyEn: a.bodyEn ?? '', isPublished: a.isPublished }); setLang('tr'); setPreview(false); }}>
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button className="icon-button" aria-label={t('common.delete')} onClick={() => void remove(a)}><Trash2 className="h-4 w-4 text-red-500" /></button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {pagination && pagination.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-1 pt-3 dark:border-slate-800">
            <span className="text-sm text-muted">
              {t('kb.staff.showingSummary', {
                total: pagination.total,
                from: (pagination.page - 1) * pagination.limit + 1,
                to: Math.min(pagination.page * pagination.limit, pagination.total),
              })}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={pagination.page <= 1}
                className="icon-button min-h-9 min-w-9 disabled:opacity-30"
                aria-label={t('kb.staff.prevPage')}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className="text-sm">{t('kb.staff.pageInfo', { page: pagination.page, totalPages: pagination.totalPages })}</span>
              <button
                onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                disabled={pagination.page >= pagination.totalPages}
                className="icon-button min-h-9 min-w-9 disabled:opacity-30"
                aria-label={t('kb.staff.nextPage')}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
