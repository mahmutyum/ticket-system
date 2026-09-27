import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox, Link2, PlugZap, Trash2, X } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { dateLocale } from '../../i18n/format';
import { getApiError } from '../../utils/api-error';

type Provider = 'imap' | 'microsoft365' | 'gmail';

type Mailbox = {
  id: string;
  provider: Provider;
  address: string;
  isActive: boolean;
  imapHost: string | null;
  imapPort: number | null;
  imapSecure: boolean;
  username: string | null;
  tenantId: string | null;
  clientId: string | null;
  hasSecret: boolean;
  gmailConnected: boolean;
  createTickets: boolean;
  defaultCategoryId: string | null;
  defaultLocationId: string | null;
  defaultLocale: string;
  lastFetchAt: string | null;
  lastError: string | null;
};

type InboundLog = {
  id: string;
  fromEmail: string;
  subject: string;
  action: 'reply' | 'created' | 'ignored' | 'failed';
  reason: string | null;
  ticketId: string | null;
  receivedAt: string;
};

type MailboxView = { mailbox: Mailbox | null; recent: InboundLog[]; googleRedirectUri: string };
type Option = { id: string; name: string };

type FormState = {
  provider: Provider;
  address: string;
  isActive: boolean;
  imapHost: string;
  imapPort: string;
  imapSecure: boolean;
  username: string;
  tenantId: string;
  clientId: string;
  secret: string;
  createTickets: boolean;
  defaultCategoryId: string;
  defaultLocationId: string;
  defaultLocale: 'tr' | 'en';
};

const emptyForm: FormState = {
  provider: 'imap', address: '', isActive: true, imapHost: '', imapPort: '993', imapSecure: true, username: '',
  tenantId: '', clientId: '', secret: '', createTickets: false, defaultCategoryId: '', defaultLocationId: '', defaultLocale: 'tr',
};

function toForm(m: Mailbox): FormState {
  return {
    provider: m.provider, address: m.address, isActive: m.isActive,
    imapHost: m.imapHost ?? '', imapPort: String(m.imapPort ?? 993), imapSecure: m.imapSecure, username: m.username ?? '',
    tenantId: m.tenantId ?? '', clientId: m.clientId ?? '', secret: '',
    createTickets: m.createTickets, defaultCategoryId: m.defaultCategoryId ?? '', defaultLocationId: m.defaultLocationId ?? '',
    defaultLocale: m.defaultLocale === 'en' ? 'en' : 'tr',
  };
}

function toPayload(f: FormState) {
  return {
    provider: f.provider,
    address: f.address,
    isActive: f.isActive,
    imapHost: f.provider === 'imap' ? f.imapHost : null,
    imapPort: f.provider === 'imap' ? Number(f.imapPort) : null,
    imapSecure: f.imapSecure,
    username: f.provider === 'imap' ? f.username : null,
    tenantId: f.provider === 'microsoft365' ? f.tenantId : null,
    clientId: f.provider === 'imap' ? null : f.clientId,
    ...(f.secret ? { secret: f.secret } : {}),
    createTickets: f.createTickets,
    defaultCategoryId: f.defaultCategoryId || null,
    defaultLocationId: f.defaultLocationId || null,
    defaultLocale: f.defaultLocale,
  };
}

const ACTION_STYLES: Record<InboundLog['action'], string> = {
  reply: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
  created: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
  ignored: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
};

export function MailboxModal({ companyId, companyName, onClose }: { companyId: string; companyName: string; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = ['company-mailbox', companyId];

  const { data, isLoading } = useQuery<MailboxView>({
    queryKey,
    queryFn: async () => (await api.get(`/companies/${companyId}/mailbox`)).data.data,
  });
  const { data: categories = [] } = useQuery<Option[]>({
    queryKey: ['company-categories', companyId],
    queryFn: async () => (await api.get(`/companies/${companyId}/categories`)).data.data,
  });
  const { data: locations = [] } = useQuery<Option[]>({
    queryKey: ['company-locations', companyId],
    queryFn: async () => (await api.get(`/companies/${companyId}/locations`)).data.data,
  });

  const [draft, setDraft] = useState<FormState | null>(null);
  const form = draft ?? (data?.mailbox ? toForm(data.mailbox) : emptyForm);
  const set = (patch: Partial<FormState>) => setDraft({ ...form, ...patch });
  const [busy, setBusy] = useState<'save' | 'test' | 'google' | 'delete' | null>(null);
  const mailbox = data?.mailbox ?? null;

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('save');
    try {
      const res = await api.put(`/companies/${companyId}/mailbox`, toPayload(form));
      queryClient.setQueryData(queryKey, res.data.data);
      setDraft(null);
      toast.success(t('companyMgmt.mailbox.saved'));
    } catch (err) {
      toast.error(getApiError(err, t('companyMgmt.mailbox.saveFailed')));
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async () => {
    setBusy('test');
    try {
      const res = await api.post(`/companies/${companyId}/mailbox/test`);
      toast.success(t('companyMgmt.mailbox.testOk', { count: res.data.data.unreadSample }));
    } catch (err) {
      toast.error(getApiError(err, t('companyMgmt.mailbox.testFailed')));
    } finally {
      setBusy(null);
    }
  };

  const handleGoogle = async () => {
    setBusy('google');
    try {
      const res = await api.post(`/companies/${companyId}/mailbox/google/authorize`);
      window.location.assign(res.data.data.url);
    } catch (err) {
      toast.error(getApiError(err, t('companyMgmt.mailbox.googleFailed')));
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    setBusy('delete');
    try {
      await api.delete(`/companies/${companyId}/mailbox`);
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey });
      toast.success(t('companyMgmt.mailbox.deleted'));
    } catch (err) {
      toast.error(getApiError(err, t('companyMgmt.mailbox.saveFailed')));
    } finally {
      setBusy(null);
    }
  };

  const secretLabel = form.provider === 'imap' ? t('companyMgmt.mailbox.password') : t('companyMgmt.mailbox.clientSecret');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t('companyMgmt.mailbox.title')} className="card max-h-[92vh] w-full max-w-4xl overflow-y-auto !p-0" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-subtle px-6 py-5">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold"><Inbox className="h-5 w-5 text-primary-500" /> {t('companyMgmt.mailbox.title')}</h2>
            <p className="mt-1 text-sm text-muted">{t('companyMgmt.mailbox.subtitle', { name: companyName })}</p>
          </div>
          <button className="icon-button border-0" onClick={onClose} aria-label={t('common.close')}><X className="h-5 w-5" /></button>
        </div>

        {isLoading ? (
          <p className="p-6 text-sm text-muted">{t('common.loading')}</p>
        ) : (
          <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <form onSubmit={(event) => void handleSave(event)} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor="mb-provider">{t('companyMgmt.mailbox.provider')}</label>
                  <select id="mb-provider" className="input-field" value={form.provider} onChange={(event) => set({ provider: event.target.value as Provider })}>
                    <option value="imap">IMAP</option>
                    <option value="microsoft365">Microsoft 365</option>
                    <option value="gmail">Gmail / Google Workspace</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor="mb-address">{t('companyMgmt.mailbox.address')}</label>
                  <input id="mb-address" type="email" required className="input-field" value={form.address} onChange={(event) => set({ address: event.target.value })} placeholder="destek@firma.com" />
                </div>
              </div>
              <p className="text-xs text-muted">{t(`companyMgmt.mailbox.hint.${form.provider}`)}</p>

              {form.provider === 'imap' && (
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_100px]">
                  <div>
                    <label className="mb-1 block text-sm font-medium" htmlFor="mb-host">{t('companyMgmt.mailbox.imapHost')}</label>
                    <input id="mb-host" required className="input-field" value={form.imapHost} onChange={(event) => set({ imapHost: event.target.value })} placeholder="imap.firma.com" />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium" htmlFor="mb-port">{t('companyMgmt.mailbox.port')}</label>
                    <input id="mb-port" type="number" required min={1} max={65535} className="input-field" value={form.imapPort} onChange={(event) => set({ imapPort: event.target.value })} />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium" htmlFor="mb-user">{t('companyMgmt.mailbox.username')}</label>
                    <input id="mb-user" required className="input-field" value={form.username} onChange={(event) => set({ username: event.target.value })} />
                  </div>
                  <label className="flex items-end gap-2 pb-2 text-sm">
                    <input type="checkbox" checked={form.imapSecure} onChange={(event) => set({ imapSecure: event.target.checked })} /> TLS
                  </label>
                </div>
              )}

              {form.provider === 'microsoft365' && (
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor="mb-tenant">{t('companyMgmt.mailbox.tenantId')}</label>
                  <input id="mb-tenant" required className="input-field font-mono" value={form.tenantId} onChange={(event) => set({ tenantId: event.target.value })} placeholder="00000000-0000-0000-0000-000000000000" />
                </div>
              )}

              {form.provider !== 'imap' && (
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor="mb-client">{t('companyMgmt.mailbox.clientId')}</label>
                  <input id="mb-client" required className="input-field font-mono" value={form.clientId} onChange={(event) => set({ clientId: event.target.value })} />
                </div>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="mb-secret">{secretLabel}</label>
                <input id="mb-secret" type="password" autoComplete="new-password" className="input-field" value={form.secret}
                  required={!mailbox?.hasSecret} onChange={(event) => set({ secret: event.target.value })}
                  placeholder={mailbox?.hasSecret ? t('companyMgmt.mailbox.secretKept') : ''} />
              </div>

              {form.provider === 'gmail' && data && (
                <div className="rounded-inset border border-subtle p-3 text-xs">
                  <p className="font-medium">{t('companyMgmt.mailbox.redirectUri')}</p>
                  <code className="mt-1 block break-all">{data.googleRedirectUri}</code>
                </div>
              )}

              <div className="space-y-3 border-t border-subtle pt-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.isActive} onChange={(event) => set({ isActive: event.target.checked })} />
                  {t('companyMgmt.mailbox.active')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.createTickets} onChange={(event) => set({ createTickets: event.target.checked })} />
                  {t('companyMgmt.mailbox.createTickets')}
                </label>
                {form.createTickets && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium" htmlFor="mb-cat">{t('companyMgmt.mailbox.defaultCategory')}</label>
                      <select id="mb-cat" required className="input-field" value={form.defaultCategoryId} onChange={(event) => set({ defaultCategoryId: event.target.value })}>
                        <option value="">—</option>
                        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium" htmlFor="mb-loc">{t('companyMgmt.mailbox.defaultLocation')}</label>
                      <select id="mb-loc" required className="input-field" value={form.defaultLocationId} onChange={(event) => set({ defaultLocationId: event.target.value })}>
                        <option value="">—</option>
                        {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium" htmlFor="mb-locale">{t('companyMgmt.mailbox.defaultLocale')}</label>
                      <select id="mb-locale" className="input-field" value={form.defaultLocale} onChange={(event) => set({ defaultLocale: event.target.value as 'tr' | 'en' })}>
                        <option value="tr">Türkçe</option>
                        <option value="en">English</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap justify-end gap-2 border-t border-subtle pt-4">
                {mailbox && (
                  <button type="button" className="btn-secondary mr-auto text-red-600" disabled={busy !== null} onClick={() => void handleDelete()}>
                    <Trash2 className="mr-1 inline h-4 w-4" />{t('common.delete')}
                  </button>
                )}
                {mailbox && !draft && (
                  <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => void handleTest()}>
                    <PlugZap className="mr-1 inline h-4 w-4" />{busy === 'test' ? t('common.loading') : t('companyMgmt.mailbox.test')}
                  </button>
                )}
                {mailbox?.provider === 'gmail' && !draft && (
                  <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => void handleGoogle()}>
                    <Link2 className="mr-1 inline h-4 w-4" />
                    {mailbox.gmailConnected ? t('companyMgmt.mailbox.googleReconnect') : t('companyMgmt.mailbox.googleConnect')}
                  </button>
                )}
                <button type="submit" className="btn-primary" disabled={busy !== null || (!!mailbox && !draft)}>
                  {busy === 'save' ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </form>

            <aside className="space-y-3 text-sm">
              <h3 className="font-semibold">{t('companyMgmt.mailbox.status')}</h3>
              {!mailbox ? (
                <p className="text-xs text-muted">{t('companyMgmt.mailbox.notConfigured')}</p>
              ) : (
                <dl className="space-y-1 text-xs">
                  {mailbox.provider === 'gmail' && (
                    <div className="flex justify-between"><dt className="text-muted">Google</dt><dd>{mailbox.gmailConnected ? t('companyMgmt.mailbox.connected') : t('companyMgmt.mailbox.notConnected')}</dd></div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-muted">{t('companyMgmt.mailbox.lastFetch')}</dt>
                    <dd>{mailbox.lastFetchAt ? new Date(mailbox.lastFetchAt).toLocaleString(dateLocale()) : '—'}</dd>
                  </div>
                  {mailbox.lastError && <dd className="rounded-inset bg-red-50 p-2 text-red-700 dark:bg-red-500/10 dark:text-red-300">{mailbox.lastError}</dd>}
                </dl>
              )}

              <h3 className="pt-2 font-semibold">{t('companyMgmt.mailbox.recent')}</h3>
              <ul className="divide-y divide-gray-100 dark:divide-slate-800">
                {data?.recent.length === 0 && <li className="py-2 text-xs text-muted">{t('companyMgmt.mailbox.noMessages')}</li>}
                {data?.recent.map((m) => (
                  <li key={m.id} className="space-y-0.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ACTION_STYLES[m.action]}`}>{t(`companyMgmt.mailbox.action.${m.action}`)}</span>
                      <span className="text-[11px] text-muted">{new Date(m.receivedAt).toLocaleString(dateLocale())}</span>
                    </div>
                    <p className="truncate text-xs" title={m.subject}>{m.subject || '—'}</p>
                    <p className="truncate text-[11px] text-muted">
                      {m.fromEmail}
                      {m.reason && ` · ${t(`companyMgmt.mailbox.reason.${m.reason.split(':')[0]}`, { defaultValue: m.reason })}`}
                    </p>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
