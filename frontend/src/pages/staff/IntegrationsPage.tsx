import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Copy, Pencil, Plus, RefreshCw, Send, Trash2, Webhook as WebhookIcon, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { dateLocale } from '../../i18n/format';
import { getApiError } from '../../utils/api-error';
import { PageHeader } from '../../components/ui/PageHeader';
import type { Company } from '../../types';

type Kind = 'generic' | 'teams' | 'slack';

type Webhook = {
  id: string;
  name: string;
  kind: Kind;
  host: string;
  events: string[];
  companyId: string | null;
  isActive: boolean;
  hasSecret: boolean;
  lastDeliveredAt: string | null;
  lastError: string | null;
};

type Delivery = {
  id: string;
  event: string;
  status: 'pending' | 'success' | 'failed';
  statusCode: number | null;
  error: string | null;
  attempts: number;
  createdAt: string;
};

const EVENTS = [
  'ticket.created', 'ticket.status_changed', 'ticket.assigned', 'ticket.priority_changed',
  'ticket.note_added', 'ticket.user_reply', 'sla.warning', 'sla.breached', 'ticket.rated',
] as const;

type FormState = { id: string | null; name: string; kind: Kind; url: string; events: string[]; companyId: string; isActive: boolean };
const emptyForm: FormState = { id: null, name: '', kind: 'teams', url: '', events: ['ticket.created', 'sla.breached'], companyId: '', isActive: true };

const STATUS_STYLE: Record<Delivery['status'], string> = {
  success: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
  pending: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
};

export default function IntegrationsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: hooks = [] } = useQuery<Webhook[]>({
    queryKey: ['webhooks'],
    queryFn: async () => (await api.get('/webhooks')).data.data,
  });
  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ['companies-admin'],
    queryFn: async () => (await api.get('/companies/admin/all')).data.data,
  });
  const { data: deliveries = [] } = useQuery<Delivery[]>({
    queryKey: ['webhook-deliveries', selected],
    queryFn: async () => (await api.get(`/webhooks/${selected}/deliveries`)).data.data,
    enabled: !!selected,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    await queryClient.invalidateQueries({ queryKey: ['webhook-deliveries'] });
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    try {
      const payload = {
        name: form.name, kind: form.kind, events: form.events, isActive: form.isActive,
        companyId: form.companyId || null, ...(form.url ? { url: form.url } : {}),
      };
      if (form.id) {
        await api.put(`/webhooks/${form.id}`, payload);
      } else {
        const res = await api.post('/webhooks', payload);
        if (res.data.data.secret) setSecret(res.data.data.secret);
      }
      await refresh();
      setForm(null);
      toast.success(t('integrations.saved'));
    } catch (err) {
      toast.error(getApiError(err, t('integrations.failed')));
    } finally {
      setBusy(false);
    }
  };

  const action = async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn();
      await refresh();
      if (success) toast.success(success);
    } catch (err) {
      toast.error(getApiError(err, t('integrations.failed')));
    }
  };

  const test = (hook: Webhook) => action(async () => {
    const res = await api.post(`/webhooks/${hook.id}/test`);
    const d = res.data.data as Delivery;
    setSelected(hook.id);
    if (d.status === 'success') toast.success(t('integrations.testOk', { code: d.statusCode }));
    else toast.error(t('integrations.testFailed', { error: d.error ?? '' }));
  });

  const rotate = (hook: Webhook) => action(async () => {
    const res = await api.post(`/webhooks/${hook.id}/rotate-secret`);
    setSecret(res.data.data.secret);
  });

  const companyName = (id: string | null) => (id ? companies.find(c => c.id === id)?.name ?? '?' : t('integrations.allCompanies'));

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t('integrations.eyebrow')} title={t('integrations.title')} description={t('integrations.description')} actions={
        <button className="btn-primary flex items-center gap-2" onClick={() => setForm({ ...emptyForm })}>
          <Plus className="h-4 w-4" /> {t('integrations.add')}
        </button>
      } />

      {secret && (
        <div className="card border border-amber-300 bg-amber-50 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold">{t('integrations.secretTitle')}</p>
              <p className="text-xs text-muted">{t('integrations.secretHint')}</p>
              <code className="mt-2 block break-all font-mono text-xs">{secret}</code>
            </div>
            <div className="flex gap-1">
              <button className="icon-button" aria-label={t('integrations.copy')} onClick={() => void navigator.clipboard.writeText(secret).then(() => toast.success(t('integrations.copied')))}>
                <Copy className="h-4 w-4" />
              </button>
              <button className="icon-button" aria-label={t('common.close')} onClick={() => setSecret(null)}><X className="h-4 w-4" /></button>
            </div>
          </div>
        </div>
      )}

      {form && (
        <form onSubmit={e => void save(e)} className="card space-y-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="wh-kind">{t('integrations.kind')}</label>
              <select id="wh-kind" className="input-field" value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value as Kind })}>
                <option value="teams">Microsoft Teams</option>
                <option value="slack">Slack</option>
                <option value="generic">{t('integrations.generic')}</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="wh-name">{t('integrations.name')}</label>
              <input id="wh-name" required className="input-field" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="IT kanalı" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="wh-company">{t('integrations.company')}</label>
              <select id="wh-company" className="input-field" value={form.companyId} onChange={e => setForm({ ...form, companyId: e.target.value })}>
                <option value="">{t('integrations.allCompanies')}</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="wh-url">{t('integrations.url')}</label>
            <input id="wh-url" type="url" required={!form.id} className="input-field font-mono text-xs" value={form.url}
              onChange={e => setForm({ ...form, url: e.target.value })}
              placeholder={form.id ? t('integrations.urlKept') : 'https://'} />
            <p className="mt-1 text-xs text-muted">{t(`integrations.hint.${form.kind}`)}</p>
          </div>
          <fieldset>
            <legend className="mb-1 text-xs font-medium">{t('integrations.events')}</legend>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {EVENTS.map(ev => (
                <label key={ev} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={form.events.includes(ev)}
                    onChange={e => setForm({ ...form, events: e.target.checked ? [...form.events, ev] : form.events.filter(x => x !== ev) })} />
                  {t(`integrations.eventNames.${ev.replace('.', '_')}`)}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">{t('integrations.internalNotesHint')}</p>
          </fieldset>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} /> {t('integrations.active')}
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setForm(null)}>{t('common.cancel')}</button>
            <button type="submit" className="btn-primary" disabled={busy || form.events.length === 0}>{busy ? t('common.saving') : t('common.save')}</button>
          </div>
        </form>
      )}

      <div className="card overflow-x-auto !p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-gray-500 dark:bg-slate-800/50">
              <th className="px-4 py-3">{t('integrations.name')}</th>
              <th className="px-4 py-3">{t('integrations.target')}</th>
              <th className="px-4 py-3">{t('integrations.company')}</th>
              <th className="px-4 py-3">{t('integrations.status')}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {hooks.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">{t('integrations.empty')}</td></tr>
            )}
            {hooks.map(hook => (
              <tr key={hook.id} className={`border-t ${selected === hook.id ? 'bg-primary-50/50 dark:bg-primary-500/5' : ''}`}>
                <td className="px-4 py-3">
                  <button type="button" className="text-left font-medium hover:underline" onClick={() => setSelected(hook.id)}>{hook.name}</button>
                  <p className="text-xs text-muted">{hook.kind === 'generic' ? t('integrations.generic') : hook.kind === 'teams' ? 'Teams' : 'Slack'} · {hook.events.length} {t('integrations.eventsShort')}</p>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{hook.host}</td>
                <td className="px-4 py-3 text-xs">{companyName(hook.companyId)}</td>
                <td className="px-4 py-3 text-xs">
                  {!hook.isActive ? <span className="text-muted">{t('integrations.inactive')}</span>
                    : hook.lastError ? <span className="text-red-600" title={hook.lastError}>{t('integrations.lastFailed')}</span>
                      : hook.lastDeliveredAt ? <span className="text-green-700 dark:text-green-300">{new Date(hook.lastDeliveredAt).toLocaleString(dateLocale())}</span>
                        : <span className="text-muted">—</span>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <button className="icon-button" title={t('integrations.test')} aria-label={t('integrations.test')} onClick={() => void test(hook)}><Send className="h-4 w-4" /></button>
                    {hook.kind === 'generic' && (
                      <button className="icon-button" title={t('integrations.rotate')} aria-label={t('integrations.rotate')} onClick={() => void rotate(hook)}><RefreshCw className="h-4 w-4" /></button>
                    )}
                    <button className="icon-button" aria-label={t('common.edit')}
                      onClick={() => setForm({ id: hook.id, name: hook.name, kind: hook.kind, url: '', events: hook.events, companyId: hook.companyId ?? '', isActive: hook.isActive })}>
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button className="icon-button" aria-label={t('common.delete')} onClick={() => void action(() => api.delete(`/webhooks/${hook.id}`), t('integrations.deleted'))}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="card space-y-3 text-sm">
          <h2 className="flex items-center gap-2 font-semibold"><WebhookIcon className="h-4 w-4" /> {t('integrations.deliveries')}</h2>
          {deliveries.length === 0 && <p className="text-xs text-muted">{t('integrations.noDeliveries')}</p>}
          <ul className="divide-y divide-gray-100 dark:divide-slate-800">
            {deliveries.map(d => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                <span className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${STATUS_STYLE[d.status]}`}>{d.statusCode ?? d.status}</span>
                  <span className="font-mono">{d.event}</span>
                  <span className="text-muted">{new Date(d.createdAt).toLocaleString(dateLocale())} · {t('integrations.attempts', { count: d.attempts })}</span>
                </span>
                <span className="flex items-center gap-2">
                  {d.error && <span className="max-w-xs truncate text-red-600" title={d.error}>{d.error}</span>}
                  {d.status === 'failed' && (
                    <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => void action(() => api.post(`/webhooks/deliveries/${d.id}/retry`), t('integrations.retryQueued'))}>
                      {t('integrations.retry')}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
