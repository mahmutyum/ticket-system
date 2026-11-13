import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FolderSearch, Pencil, PlugZap, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { getApiError } from '../../utils/api-error';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState } from '../../components/ui/AsyncState';
import { Modal } from '../../components/ui/Modal';

/**
 * Yedekler (v1.2, admin) — uzak yedek hedefleri yönetimi: rclone config INI
 * (şifreli, write-only), GFS saklama adetleri, bağlantı testi, hedefteki
 * yedek listesi ve son yükleme sonucu. Geri yükleme bilinçli olarak web'den
 * YAPILMAZ (yıkıcı işlem, CLI + operatör onayı).
 */

type Target = {
  id: string;
  name: string;
  type: string;
  retentionDaily: number;
  retentionWeekly: number;
  retentionMonthly: number;
  enabled: boolean;
  hasConfig: boolean;
  lastResult: { ok?: boolean; stamp?: string; error?: string; at?: string } | null;
  lastSuccessAt: string | null;
};

type FormState = {
  id: string | null;
  name: string;
  type: string;
  configIni: string;
  retentionDaily: number;
  retentionWeekly: number;
  retentionMonthly: number;
  enabled: boolean;
};

const EMPTY_FORM: FormState = { id: null, name: '', type: 's3', configIni: '', retentionDaily: 7, retentionWeekly: 4, retentionMonthly: 6, enabled: true };

const TYPES = ['local', 's3', 'gdrive', 'ftp', 'sftp', 'webdav', 'smb'] as const;

const SAMPLE_INI = `[target]
type = s3
provider = AWS
access_key_id = <ACCESS KEY>
secret_access_key = <SECRET KEY>
endpoint = https://s3.example.com
region = eu-central-1`;

export default function BackupsPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);
  const [listTarget, setListTarget] = useState<Target | null>(null);

  const { data: targets = [], isLoading, isError: loadFailed, refetch } = useQuery({
    queryKey: ['backup-targets'],
    queryFn: async () => (await api.get('/backups/targets')).data.data as Target[],
  });

  const { data: backupList } = useQuery({
    queryKey: ['backup-list', listTarget?.id],
    enabled: !!listTarget,
    queryFn: async () => (await api.get(`/backups/targets/${listTarget!.id}/backups`)).data.data as { at: string; dirs: string[] },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['backup-targets'] });

  const saveMutation = useMutation({
    mutationFn: async (payload: FormState) => {
      if (payload.id) {
        return api.put(`/backups/targets/${payload.id}`, payload);
      }
      return api.post('/backups/targets', payload);
    },
    onSuccess: () => { void invalidate(); setForm(null); toast.success(t('backups.saved')); },
    onError: (err) => toast.error(getApiError(err, t('backups.failed'))),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/backups/targets/${id}`),
    onSuccess: () => { void invalidate(); toast.success(t('backups.deleted')); },
    onError: (err) => toast.error(getApiError(err, t('backups.failed'))),
  });

  const [testTargetId, setTestTargetId] = useState<string | null>(null);
  const testMutation = useMutation({
    mutationFn: async (id: string) => (await api.post(`/backups/targets/${id}/test`)).data.data as { ok: boolean; error?: string },
    onMutate: (id) => setTestTargetId(id),
    onSuccess: (result) => {
      setTestTargetId(null);
      if (result.ok) toast.success(t('backups.testOk'));
      else toast.error(t('backups.testFailed', { error: result.error ?? '' }));
    },
    onError: (err) => { setTestTargetId(null); toast.error(getApiError(err, t('backups.failed'))); },
  });

  const lang = i18n.language.startsWith('en') ? 'en' : 'tr';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('backups.eyebrow')}
        title={t('backups.title')}
        description={t('backups.description')}
        actions={
          <button className="btn-primary flex items-center gap-2" onClick={() => setForm({ ...EMPTY_FORM })}>
            <Plus className="h-4 w-4" /> {t('backups.new')}
          </button>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : loadFailed ? (
        <ErrorState title={t('common.loadError')} retryLabel={t('common.retry')} onRetry={() => void refetch()} />
      ) : targets.length === 0 ? (
        <p className="text-sm text-muted">{t('backups.empty')}</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="data-table">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-500 dark:bg-slate-800/50">
                <th className="px-4 py-3 font-medium">{t('backups.name')}</th>
                <th className="px-4 py-3 font-medium">{t('backups.retention')}</th>
                <th className="px-4 py-3 font-medium">{t('backups.lastUpload')}</th>
                <th className="px-4 py-3 font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((target) => (
                <tr key={target.id} className="border-t align-top">
                  <td className="px-4 py-3">
                    <p className="font-semibold">{target.name}</p>
                    <p className="text-xs text-muted">{target.type}{target.enabled ? '' : ` · ${t('backups.disabled')}`}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {target.retentionDaily}/{target.retentionWeekly}/{target.retentionMonthly}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {target.lastSuccessAt ? (
                      <>
                        <p>{new Date(target.lastSuccessAt).toLocaleString(lang)}</p>
                        {target.lastResult && !target.lastResult.ok && (
                          <p className="text-red-600">{target.lastResult.error}</p>
                        )}
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <button className="icon-button" title={t('backups.test')} aria-label={t('backups.test')}
                        disabled={testTargetId === target.id}
                        onClick={() => testMutation.mutate(target.id)}>
                        <PlugZap className={`h-4 w-4 ${testTargetId === target.id ? 'animate-pulse' : ''}`} />
                      </button>
                      <button className="icon-button" title={t('backups.list')} aria-label={t('backups.list')}
                        onClick={() => setListTarget(target)}>
                        <FolderSearch className="h-4 w-4" />
                      </button>
                      <button className="icon-button" title={t('common.edit')} aria-label={t('common.edit')}
                        onClick={() => setForm({ id: target.id, name: target.name, type: target.type, configIni: '', retentionDaily: target.retentionDaily, retentionWeekly: target.retentionWeekly, retentionMonthly: target.retentionMonthly, enabled: target.enabled })}>
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button className="icon-button" title={t('common.delete')} aria-label={t('common.delete')}
                        onClick={() => removeMutation.mutate(target.id)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? t('backups.editTitle') : t('backups.newTitle')}
        ariaLabel={t('backups.new')}
        closeOnBackdrop={false}
        panelClassName="space-y-3 max-h-[90vh] overflow-y-auto text-sm"
      >
        {form && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(form); }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium" htmlFor="bt-name">{t('backups.name')}</label>
                <input id="bt-name" className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={120} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" htmlFor="bt-type">{t('backups.type')}</label>
                <select id="bt-type" className="input-field" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="bt-ini">
                {form.id ? t('backups.configReplace') : t('backups.config')}
              </label>
              <textarea id="bt-ini" className="input-field min-h-[140px] font-mono text-xs"
                value={form.configIni} onChange={(e) => setForm({ ...form, configIni: e.target.value })}
                placeholder={SAMPLE_INI}
                required={!form.id} maxLength={20_000} />
              <p className="mt-1 text-xs text-muted">{t('backups.configHint')}</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium" htmlFor="bt-rd">{t('backups.daily')}</label>
                <input id="bt-rd" type="number" min={1} max={365} className="input-field" value={form.retentionDaily} onChange={(e) => setForm({ ...form, retentionDaily: Number(e.target.value) || 1 })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" htmlFor="bt-rw">{t('backups.weekly')}</label>
                <input id="bt-rw" type="number" min={1} max={104} className="input-field" value={form.retentionWeekly} onChange={(e) => setForm({ ...form, retentionWeekly: Number(e.target.value) || 1 })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" htmlFor="bt-rm">{t('backups.monthly')}</label>
                <input id="bt-rm" type="number" min={1} max={120} className="input-field" value={form.retentionMonthly} onChange={(e) => setForm({ ...form, retentionMonthly: Number(e.target.value) || 1 })} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> {t('backups.enabled')}
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setForm(null)}>{t('common.cancel')}</button>
              <button type="submit" className="btn-primary" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={!!listTarget}
        onClose={() => setListTarget(null)}
        title={t('backups.listTitle', { name: listTarget?.name ?? '' })}
        ariaLabel={t('backups.list')}
        size="max-w-2xl"
        panelClassName="max-h-[85vh] overflow-y-auto"
      >
        <div className="space-y-2 font-mono text-sm">
          {backupList === undefined && <p className="text-muted">{t('common.loading')}</p>}
          {backupList && backupList.dirs.length === 0 && <p className="text-muted">{t('backups.noBackups')}</p>}
          {backupList?.dirs.map((dir) => (
            <p key={dir}>{dir}</p>
          ))}
        </div>
      </Modal>
    </div>
  );
}
