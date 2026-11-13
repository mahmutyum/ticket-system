import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Check, Plus, Save, Undo2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { getApiError } from '../../utils/api-error';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState } from '../../components/ui/AsyncState';
import { Modal } from '../../components/ui/Modal';

/**
 * Sözlükler (v1.3, admin) — DB'den yönetilen durum/öncelik/şirket türü vb.
 * listeler: panelden eklenen yeni bir durum deploy'suz tüm arayüzde görünür.
 *
 * Kural: `key` değişmez; isSystem kayıtları silinemez; kullanımdaki kayıtlar
 * silinmez — pasifleştirilir veya başka bir anahtarla birleştirilir.
 * ticket durumlarında "sınıf başına en az bir aktif" sunucu tarafından korunur.
 */

type Entry = {
  key: string;
  labelTr: string;
  labelEn: string;
  color: string | null;
  sortOrder: number;
  statusClass?: string | null;
  weight?: number | null;
  isActive: boolean;
  isSystem: boolean;
};

type Kind = 'ticketStatuses' | 'priorities' | 'taskStatuses' | 'onsiteTypes' | 'onsiteStatuses' | 'companyTypes';

const KINDS: Array<{ kind: Kind; label: string; hasClass: boolean; hasWeight: boolean }> = [
  { kind: 'ticketStatuses', label: 'Ticket durumları', hasClass: true, hasWeight: false },
  { kind: 'priorities', label: 'Öncelikler', hasClass: false, hasWeight: true },
  { kind: 'taskStatuses', label: 'Görev durumları', hasClass: false, hasWeight: false },
  { kind: 'onsiteTypes', label: 'Yerinde destek türleri', hasClass: false, hasWeight: false },
  { kind: 'onsiteStatuses', label: 'Yerinde destek durumları', hasClass: false, hasWeight: false },
  { kind: 'companyTypes', label: 'Şirket türleri', hasClass: false, hasWeight: false },
];

const COLOR_TOKENS = ['blue', 'green', 'red', 'gray', 'yellow', 'purple', 'indigo', 'orange'] as const;

const CLASSES = ['new', 'active', 'waiting', 'resolved', 'closed'] as const;

type Draft = {
  isNew?: boolean;
  key: string;
  labelTr: string;
  labelEn: string;
  color: string;
  sortOrder: number;
  statusClass?: string;
  weight?: number;
  isActive: boolean;
};

export default function DictionariesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeKind, setActiveKind] = useState<Kind>('ticketStatuses');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [newForm, setNewForm] = useState<Draft | null>(null);
  const [mergeKey, setMergeKey] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState('');

  const kindMeta = useMemo(() => KINDS.find((k) => k.kind === activeKind)!, [activeKind]);

  const { data: grouped, isLoading, isError: loadFailed, refetch } = useQuery({
    queryKey: ['lookups-admin'],
    queryFn: async () => (await api.get('/lookups')).data.data as Record<Kind, Entry[]>,
  });
  const entries: Entry[] = grouped?.[activeKind] ?? [];

  const draftFor = (entry: Entry): Draft => drafts[entry.key] ?? {
    key: entry.key, labelTr: entry.labelTr, labelEn: entry.labelEn,
    color: entry.color ?? 'gray', sortOrder: entry.sortOrder,
    statusClass: entry.statusClass ?? undefined, weight: entry.weight ?? undefined,
    isActive: entry.isActive,
  };
  const setDraft = (entry: Entry, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [entry.key]: { ...draftFor(entry), ...patch } }));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['lookups-admin'] });
    queryClient.invalidateQueries({ queryKey: ['lookups'] });
  };

  const saveMutation = useMutation({
    mutationFn: async (draft: Draft) => {
      if (draft.isNew) {
        return api.post(`/lookups/${activeKind}`, draft);
      }
      return api.put(`/lookups/${activeKind}/${draft.key}`, draft);
    },
    onSuccess: () => { void invalidate(); setNewForm(null); toast.success(t('dictionaries.saved')); },
    onError: (err) => toast.error(getApiError(err, t('dictionaries.failed'))),
  });

  const mergeMutation = useMutation({
    mutationFn: async (payload: { key: string; targetKey: string }) =>
      api.post(`/lookups/${activeKind}/${payload.key}/merge`, { targetKey: payload.targetKey }),
    onSuccess: () => { void invalidate(); setMergeKey(null); toast.success(t('dictionaries.merged')); },
    onError: (err) => toast.error(getApiError(err, t('dictionaries.failed'))),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('dictionaries.eyebrow')}
        title={t('dictionaries.title')}
        description={t('dictionaries.description')}
        actions={
          <button className="btn-primary flex items-center gap-2" onClick={() => setNewForm({
            key: '', labelTr: '', labelEn: '', color: 'blue', sortOrder: (entries.at(-1)?.sortOrder ?? 0) + 10,
            statusClass: activeKind === 'ticketStatuses' ? 'active' : undefined,
            weight: activeKind === 'priorities' ? (entries.at(-1)?.weight ?? 0) + 1 : undefined,
            isActive: true, isNew: true,
          })}>
            <Plus className="h-4 w-4" /> {t('dictionaries.new')}
          </button>
        }
      />

      <div className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button key={k.kind} onClick={() => setActiveKind(k.kind)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${activeKind === k.kind ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300'}`}>
            {t(`dictionaries.kind.${k.kind}`)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : loadFailed ? (
        <ErrorState title={t('common.loadError')} retryLabel={t('common.retry')} onRetry={() => void refetch()} />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="data-table">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-500 dark:bg-slate-800/50">
                <th className="px-3 py-3 font-medium">Key</th>
                <th className="px-3 py-3 font-medium">TR</th>
                <th className="px-3 py-3 font-medium">EN</th>
                <th className="px-3 py-3 font-medium">{t('dictionaries.color')}</th>
                <th className="px-3 py-3 font-medium">{t('dictionaries.sortOrder')}</th>
                {kindMeta.hasClass && <th className="px-3 py-3 font-medium">{t('dictionaries.class')}</th>}
                {kindMeta.hasWeight && <th className="px-3 py-3 font-medium">{t('dictionaries.weight')}</th>}
                <th className="px-3 py-3 font-medium">{t('dictionaries.active')}</th>
                <th className="px-3 py-3 font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const draft = draftFor(entry);
                const dirty = JSON.stringify(draft) !== JSON.stringify(draftFor(entry)) && drafts[entry.key] !== undefined;
                return (
                  <tr key={entry.key} className={`border-t ${entry.isActive ? '' : 'opacity-55'}`}>
                    <td className="px-3 py-2 font-mono text-xs">
                      {entry.key}
                      {entry.isSystem && <span className="ml-1 rounded bg-gray-200 px-1 text-[10px] text-gray-600 dark:bg-slate-700 dark:text-slate-300">system</span>}
                    </td>
                    <td className="px-3 py-2"><input className="input-field !w-44 text-sm" value={draft.labelTr} onChange={(e) => setDraft(entry, { labelTr: e.target.value })} maxLength={120} /></td>
                    <td className="px-3 py-2"><input className="input-field !w-44 text-sm" value={draft.labelEn} onChange={(e) => setDraft(entry, { labelEn: e.target.value })} maxLength={120} /></td>
                    <td className="px-3 py-2">
                      <select className="input-field !w-28 text-sm" value={draft.color} onChange={(e) => setDraft(entry, { color: e.target.value })}>
                        {COLOR_TOKENS.map((token) => <option key={token} value={token}>{token}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2"><input type="number" className="input-field !w-20 text-sm" value={draft.sortOrder} onChange={(e) => setDraft(entry, { sortOrder: Number(e.target.value) || 0 })} /></td>
                    {kindMeta.hasClass && (
                      <td className="px-3 py-2">
                        <select className="input-field !w-32 text-sm" value={draft.statusClass ?? ''} onChange={(e) => setDraft(entry, { statusClass: e.target.value })}>
                          {CLASSES.map((cls) => <option key={cls} value={cls}>{t(`dictionaries.class.${cls}`)}</option>)}
                        </select>
                      </td>
                    )}
                    {kindMeta.hasWeight && (
                      <td className="px-3 py-2"><input type="number" min={1} max={99} className="input-field !w-16 text-sm" value={draft.weight ?? 2} onChange={(e) => setDraft(entry, { weight: Number(e.target.value) || 1 })} /></td>
                    )}
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft(entry, { isActive: e.target.checked })} aria-label={t('dictionaries.active')} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button className="icon-button" title={t('common.save')} aria-label={t('common.save')} disabled={!dirty || saveMutation.isPending}
                          onClick={() => saveMutation.mutate(draft)}>
                          <Check className={`h-4 w-4 ${dirty ? 'text-green-600' : ''}`} />
                        </button>
                        {dirty && (
                          <button className="icon-button" title={t('common.cancel')} aria-label={t('common.cancel')}
                            onClick={() => setDrafts((prev) => { const next = { ...prev }; delete next[entry.key]; return next; })}>
                            <Undo2 className="h-4 w-4" />
                          </button>
                        )}
                        <button className="icon-button text-red-500" title={t('dictionaries.merge')} aria-label={t('dictionaries.merge')}
                          onClick={() => { setMergeKey(entry.key); setMergeTarget(''); }}>
                          <Undo2 className="h-4 w-4 rotate-90" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!newForm}
        onClose={() => setNewForm(null)}
        title={t('dictionaries.newTitle')}
        ariaLabel={t('dictionaries.new')}
        closeOnBackdrop={false}
        panelClassName="space-y-3 text-sm"
      >
        {newForm && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(newForm); }}>
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="dict-key">{t('dictionaries.keyLabel')}</label>
              <input id="dict-key" className="input-field font-mono" value={newForm.key} onChange={(e) => setNewForm({ ...newForm, key: e.target.value.toLowerCase() })}
                placeholder="orn: yeni_durum" pattern="[a-z0-9_]{1,64}" required maxLength={64} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium" htmlFor="dict-tr">{t('dictionaries.labelTr')}</label>
                <input id="dict-tr" className="input-field" value={newForm.labelTr} onChange={(e) => setNewForm({ ...newForm, labelTr: e.target.value })} required maxLength={120} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" htmlFor="dict-en">{t('dictionaries.labelEn')}</label>
                <input id="dict-en" className="input-field" value={newForm.labelEn} onChange={(e) => setNewForm({ ...newForm, labelEn: e.target.value })} required maxLength={120} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium" htmlFor="dict-color">{t('dictionaries.color')}</label>
                <select id="dict-color" className="input-field" value={newForm.color} onChange={(e) => setNewForm({ ...newForm, color: e.target.value })}>
                  {COLOR_TOKENS.map((token) => <option key={token} value={token}>{token}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" htmlFor="dict-sort">{t('dictionaries.sortOrder')}</label>
                <input id="dict-sort" type="number" min={0} className="input-field" value={newForm.sortOrder} onChange={(e) => setNewForm({ ...newForm, sortOrder: Number(e.target.value) || 0 })} />
              </div>
              {kindMeta.hasClass && (
                <div>
                  <label className="mb-1 block text-xs font-medium" htmlFor="dict-class">{t('dictionaries.class')}</label>
                  <select id="dict-class" className="input-field" value={newForm.statusClass ?? 'active'} onChange={(e) => setNewForm({ ...newForm, statusClass: e.target.value })}>
                    {CLASSES.map((cls) => <option key={cls} value={cls}>{t(`dictionaries.class.${cls}`)}</option>)}
                  </select>
                </div>
              )}
              {kindMeta.hasWeight && (
                <div>
                  <label className="mb-1 block text-xs font-medium" htmlFor="dict-weight">{t('dictionaries.weight')}</label>
                  <input id="dict-weight" type="number" min={1} max={99} className="input-field" value={newForm.weight ?? 2} onChange={(e) => setNewForm({ ...newForm, weight: Number(e.target.value) || 1 })} />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setNewForm(null)}>{t('common.cancel')}</button>
              <button type="submit" className="btn-primary" disabled={saveMutation.isPending}>{t('common.save')}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={!!mergeKey}
        onClose={() => setMergeKey(null)}
        title={t('dictionaries.mergeTitle', { key: mergeKey ?? '' })}
        ariaLabel={t('dictionaries.merge')}
        closeOnBackdrop={false}
        panelClassName="space-y-3 text-sm"
      >
        <p className="text-muted">{t('dictionaries.mergeHint')}</p>
        <div>
          <label className="mb-1 block text-xs font-medium" htmlFor="merge-target">{t('dictionaries.mergeTarget')}</label>
          <select id="merge-target" className="input-field" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
            <option value="">—</option>
            {entries.filter((entry: Entry) => entry.key !== mergeKey && entry.isActive).map((entry: Entry) => (
              <option key={entry.key} value={entry.key}>{entry.key} ({entry.labelTr})</option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={() => setMergeKey(null)}>{t('common.cancel')}</button>
          <button type="button" className="btn-primary" disabled={!mergeTarget || mergeMutation.isPending}
            onClick={() => mergeKey && mergeMutation.mutate({ key: mergeKey, targetKey: mergeTarget })}>
            {t('dictionaries.merge')}
          </button>
        </div>
      </Modal>
    </div>
  );
}
