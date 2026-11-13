import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Clock, Pause, Play, PlayCircle, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { getApiError } from '../../utils/api-error';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState } from '../../components/ui/AsyncState';
import { Modal } from '../../components/ui/Modal';

/**
 * Zamanlanmış Görevler (v1.2, admin) — merkezi cron altyapısının paneli:
 * görev listesi + son/sonraki çalışma, cron düzenleme, duraklatma ve elle
 * tetikleme. Görevin varlığı kodda tanımlıdır; panel yalnızca cron / saat
 * dilimi / aktiflik alanlarını değiştirir.
 */

type JobView = {
  key: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  description: { tr: string; en: string };
  queue: string;
  nextRuns: string[];
  lastRun: { startedAt: string; finishedAt: string | null; status: string; summary: string | null; error: string | null } | null;
};

type JobRun = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  status: string;
  summary: string | null;
  error: string | null;
};

export default function ScheduledJobsPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [editKey, setEditKey] = useState<string | null>(null);
  const [cron, setCron] = useState('');
  const [timezone, setTimezone] = useState('');
  const [historyKey, setHistoryKey] = useState<string | null>(null);

  const { data: jobs = [], isLoading, isError: loadFailed, refetch } = useQuery({
    queryKey: ['scheduled-jobs'],
    queryFn: async () => (await api.get('/scheduled-jobs')).data.data as JobView[],
  });

  const { data: runs } = useQuery({
    queryKey: ['scheduled-jobs-runs', historyKey],
    placeholderData: keepPreviousData,
    queryFn: async () =>
      (await api.get(`/scheduled-jobs/${historyKey}/runs`, { params: { page: 1, limit: 20 } })).data.data as JobRun[],
    enabled: !!historyKey,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['scheduled-jobs'] });

  const updateMutation = useMutation({
    mutationFn: async (payload: { key: string; cron?: string; timezone?: string; enabled?: boolean }) =>
      api.put(`/scheduled-jobs/${payload.key}`, payload),
    onSuccess: () => {
      void invalidate();
      setEditKey(null);
      toast.success(t('scheduledJobs.saved'));
    },
    onError: (err) => toast.error(getApiError(err, t('scheduledJobs.failed'))),
  });

  const triggerMutation = useMutation({
    mutationFn: async (key: string) => api.post(`/scheduled-jobs/${key}/trigger`),
    onSuccess: () => toast.success(t('scheduledJobs.triggered')),
    onError: (err) => toast.error(getApiError(err, t('scheduledJobs.failed'))),
  });

  const lang = i18n.language.startsWith('en') ? 'en' : 'tr';
  const statusColor = (status: string) =>
    status === 'ok' ? 'text-green-600' : status === 'failed' ? 'text-red-600' : 'text-blue-600';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('scheduledJobs.eyebrow')}
        title={t('scheduledJobs.title')}
        description={t('scheduledJobs.description')}
        actions={<button className="btn-secondary flex items-center gap-2" onClick={() => void refetch()}><RefreshCw className="h-4 w-4" /> {t('common.retry')}</button>}
      />

      {isLoading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : loadFailed ? (
        <ErrorState title={t('common.loadError')} retryLabel={t('common.retry')} onRetry={() => void refetch()} />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="data-table">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-500 dark:bg-slate-800/50">
                <th className="px-4 py-3 font-medium">{t('scheduledJobs.job')}</th>
                <th className="px-4 py-3 font-medium">{t('scheduledJobs.cron')}</th>
                <th className="px-4 py-3 font-medium">{t('scheduledJobs.lastRun')}</th>
                <th className="px-4 py-3 font-medium">{t('scheduledJobs.status')}</th>
                <th className="px-4 py-3 font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.key} className="border-t align-top">
                  <td className="px-4 py-3">
                    <p className="font-mono text-sm font-semibold">{job.key}</p>
                    <p className="text-xs text-muted">{job.description[lang]}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-mono text-xs">{job.cron}</p>
                    <p className="text-xs text-muted">{job.timezone}</p>
                    {job.nextRuns.length > 0 && (
                      <p className="mt-1 text-xs text-muted" title={job.nextRuns.join('\n')}>
                        {t('scheduledJobs.next')}: {new Date(job.nextRuns[0]).toLocaleString(lang)}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {job.lastRun ? (
                      <>
                        <p>{new Date(job.lastRun.startedAt).toLocaleString(lang)}</p>
                        <p className={statusColor(job.lastRun.status)}>{job.lastRun.status}</p>
                        {job.lastRun.summary && <p className="mt-0.5 font-mono text-muted">{job.lastRun.summary}</p>}
                        {job.lastRun.error && <p className="mt-0.5 text-red-600">{job.lastRun.error}</p>}
                      </>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${job.enabled ? 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' : 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300'}`}>
                      {job.enabled ? t('scheduledJobs.active') : t('scheduledJobs.paused')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <button className="icon-button" title={t('scheduledJobs.edit')} aria-label={t('scheduledJobs.edit')}
                        onClick={() => { setEditKey(job.key); setCron(job.cron); setTimezone(job.timezone); }}>
                        <Clock className="h-4 w-4" />
                      </button>
                      <button className="icon-button" title={t('scheduledJobs.trigger')} aria-label={t('scheduledJobs.trigger')}
                        disabled={triggerMutation.isPending}
                        onClick={() => triggerMutation.mutate(job.key)}>
                        <PlayCircle className="h-4 w-4" />
                      </button>
                      <button className="icon-button" aria-label={job.enabled ? t('scheduledJobs.pause') : t('scheduledJobs.resume')}
                        onClick={() => updateMutation.mutate({ key: job.key, enabled: !job.enabled })}>
                        {job.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </button>
                      <button className="icon-button" title={t('scheduledJobs.history')} aria-label={t('scheduledJobs.history')}
                        onClick={() => setHistoryKey(job.key)}>
                        <RefreshCw className="h-4 w-4" />
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
        open={!!editKey}
        onClose={() => setEditKey(null)}
        title={t('scheduledJobs.editTitle', { key: editKey ?? '' })}
        ariaLabel={t('scheduledJobs.edit')}
        closeOnBackdrop={false}
      >
        <form className="space-y-3 text-sm" onSubmit={(e) => { e.preventDefault(); if (editKey) updateMutation.mutate({ key: editKey, cron, timezone }); }}>
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="job-cron">{t('scheduledJobs.cron')}</label>
            <input id="job-cron" className="input-field font-mono" value={cron} onChange={(e) => setCron(e.target.value)}
              placeholder="*/5 * * * *" required maxLength={120} />
            <p className="mt-1 text-xs text-muted">{t('scheduledJobs.cronHint')}</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="job-tz">{t('scheduledJobs.timezone')}</label>
            <input id="job-tz" className="input-field font-mono" value={timezone} onChange={(e) => setTimezone(e.target.value)}
              placeholder="Europe/Istanbul" maxLength={64} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setEditKey(null)}>{t('common.cancel')}</button>
            <button type="submit" className="btn-primary" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!historyKey}
        onClose={() => setHistoryKey(null)}
        title={t('scheduledJobs.historyTitle', { key: historyKey ?? '' })}
        ariaLabel={t('scheduledJobs.history')}
        size="max-w-2xl"
        panelClassName="max-h-[85vh] overflow-y-auto"
      >
        <div className="space-y-2 text-sm">
          {(runs ?? []).length === 0 && <p className="text-muted">{t('scheduledJobs.noRuns')}</p>}
          {(runs ?? []).map((run) => (
            <div key={run.id} className="rounded-inset border border-subtle p-2">
              <p className="text-xs text-muted">
                {new Date(run.startedAt).toLocaleString(lang)}
                {run.durationMs != null && ` · ${(run.durationMs / 1000).toFixed(1)}s`}
              </p>
              <p className={`text-sm font-semibold ${statusColor(run.status)}`}>{run.status}</p>
              {run.summary && <p className="font-mono text-xs text-muted">{run.summary}</p>}
              {run.error && <p className="text-xs text-red-600">{run.error}</p>}
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
