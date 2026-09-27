import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Trash2, X } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { useEnumLabels } from '../../i18n/labels';
import { getApiError } from '../../utils/api-error';

type ProviderType = 'oidc' | 'saml' | 'ldap';
type Mapping = { group: string; role?: string; companyId?: string };

type Provider = {
  id: string;
  slug: string;
  name: string;
  type: ProviderType;
  isActive: boolean;
  config: Record<string, unknown>;
  hasSecret: boolean;
  jitProvisioning: boolean;
  roleMappings: Mapping[];
  companyMappings: Mapping[];
  urls: { redirectUri: string; acsUrl: string; metadataUrl: string };
};

type Company = { id: string; name: string };

/** Tür başına düzenlenebilir ayar alanları (backend `services/sso/config.ts` ile aynı adlar). */
const FIELDS: Record<ProviderType, Array<{ key: string; required?: boolean; multiline?: boolean; placeholder?: string }>> = {
  oidc: [
    { key: 'issuer', required: true, placeholder: 'https://login.microsoftonline.com/<tenant>/v2.0' },
    { key: 'clientId', required: true },
    { key: 'scopes', placeholder: 'openid profile email' },
    { key: 'emailClaim', placeholder: 'email' },
    { key: 'nameClaim', placeholder: 'name' },
    { key: 'groupsClaim', placeholder: 'groups' },
  ],
  saml: [
    { key: 'entryPoint', required: true, placeholder: 'https://adfs.firma.com/adfs/ls' },
    { key: 'idpCert', required: true, multiline: true, placeholder: '-----BEGIN CERTIFICATE-----' },
    { key: 'spEntityId' },
    { key: 'emailAttribute', placeholder: 'email' },
    { key: 'nameAttribute', placeholder: 'displayName' },
    { key: 'groupsAttribute', placeholder: 'groups' },
  ],
  ldap: [
    { key: 'url', required: true, placeholder: 'ldaps://dc.firma.local:636' },
    { key: 'bindDn', required: true, placeholder: 'CN=svc-ticket,OU=Service,DC=firma,DC=local' },
    { key: 'baseDn', required: true, placeholder: 'DC=firma,DC=local' },
    { key: 'userFilter', placeholder: '(&(objectClass=user)(sAMAccountName={{username}}))' },
    { key: 'emailAttribute', placeholder: 'mail' },
    { key: 'nameAttribute', placeholder: 'displayName' },
    { key: 'groupsAttribute', placeholder: 'memberOf' },
  ],
};

type FormState = {
  id: string | null;
  slug: string;
  name: string;
  type: ProviderType;
  isActive: boolean;
  config: Record<string, string>;
  allowedDomains: string;
  startTls: boolean;
  tlsRejectUnauthorized: boolean;
  secret: string;
  hasSecret: boolean;
  jitProvisioning: boolean;
  roleMappings: Mapping[];
  companyMappings: Mapping[];
};

const emptyForm: FormState = {
  id: null, slug: '', name: '', type: 'oidc', isActive: true, config: {}, allowedDomains: '', startTls: false,
  tlsRejectUnauthorized: true, secret: '', hasSecret: false, jitProvisioning: false, roleMappings: [], companyMappings: [],
};

function toForm(p: Provider): FormState {
  const config: Record<string, string> = {};
  for (const [key, value] of Object.entries(p.config)) if (typeof value === 'string') config[key] = value;
  return {
    id: p.id, slug: p.slug, name: p.name, type: p.type, isActive: p.isActive, config,
    allowedDomains: Array.isArray(p.config.allowedDomains) ? (p.config.allowedDomains as string[]).join(', ') : '',
    startTls: p.config.startTls === true, tlsRejectUnauthorized: p.config.tlsRejectUnauthorized !== false,
    secret: '', hasSecret: p.hasSecret, jitProvisioning: p.jitProvisioning,
    roleMappings: p.roleMappings, companyMappings: p.companyMappings,
  };
}

function toPayload(f: FormState) {
  const config: Record<string, unknown> = {};
  for (const field of FIELDS[f.type]) {
    const value = f.config[field.key]?.trim();
    if (value) config[field.key] = value;
  }
  config.allowedDomains = f.allowedDomains.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
  if (f.type === 'ldap') {
    config.startTls = f.startTls;
    config.tlsRejectUnauthorized = f.tlsRejectUnauthorized;
  }
  return {
    slug: f.slug, name: f.name, type: f.type, isActive: f.isActive, config,
    ...(f.secret ? { secret: f.secret } : {}),
    jitProvisioning: f.jitProvisioning,
    roleMappings: f.roleMappings.filter(m => m.group.trim()),
    companyMappings: f.companyMappings.filter(m => m.group.trim() && m.companyId),
  };
}

export function IdentityProvidersModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const labels = useEnumLabels();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<FormState>) => form && setForm({ ...form, ...patch });

  const { data: providers = [] } = useQuery<Provider[]>({
    queryKey: ['identity-providers'],
    queryFn: async () => (await api.get('/auth/sso/admin/providers')).data.data,
  });
  const { data: settings } = useQuery<{ localLoginDisabled: boolean }>({
    queryKey: ['auth-settings'],
    queryFn: async () => (await api.get('/auth/sso/admin/settings')).data.data,
  });
  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ['companies-admin'],
    queryFn: async () => (await api.get('/companies/admin/all')).data.data,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['identity-providers'] });
  const editing = form?.id ? providers.find(p => p.id === form.id) : null;

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      if (form.id) await api.put(`/auth/sso/admin/providers/${form.id}`, toPayload(form));
      else await api.post('/auth/sso/admin/providers', toPayload(form));
      await refresh();
      setForm(null);
      toast.success(t('staffMgmt.sso.saved'));
    } catch (err) {
      toast.error(getApiError(err, t('staffMgmt.sso.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (provider: Provider) => {
    try {
      await api.delete(`/auth/sso/admin/providers/${provider.id}`);
      await refresh();
      if (form?.id === provider.id) setForm(null);
    } catch (err) {
      toast.error(getApiError(err, t('staffMgmt.sso.saveFailed')));
    }
  };

  const toggleLocal = async (localLoginDisabled: boolean) => {
    try {
      const res = await api.put('/auth/sso/admin/settings', { localLoginDisabled });
      queryClient.setQueryData(['auth-settings'], res.data.data);
    } catch (err) {
      toast.error(getApiError(err, t('staffMgmt.sso.saveFailed')));
    }
  };

  const mappingRow = (kind: 'roleMappings' | 'companyMappings', index: number, mapping: Mapping) => (
    <div key={index} className="flex gap-2">
      <input className="input-field text-xs" value={mapping.group} placeholder={t('staffMgmt.sso.group')}
        onChange={e => set({ [kind]: form![kind].map((m, i) => (i === index ? { ...m, group: e.target.value } : m)) })} />
      {kind === 'roleMappings' ? (
        <select className="input-field text-xs !w-40" value={mapping.role ?? 'it_staff'}
          onChange={e => set({ roleMappings: form!.roleMappings.map((m, i) => (i === index ? { ...m, role: e.target.value } : m)) })}>
          {['it_staff', 'it_manager', 'admin'].map(r => <option key={r} value={r}>{labels.role(r)}</option>)}
        </select>
      ) : (
        <select className="input-field text-xs !w-48" value={mapping.companyId ?? ''}
          onChange={e => set({ companyMappings: form!.companyMappings.map((m, i) => (i === index ? { ...m, companyId: e.target.value } : m)) })}>
          <option value="">—</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      <button type="button" className="icon-button border-0" aria-label={t('common.delete')}
        onClick={() => set({ [kind]: form![kind].filter((_, i) => i !== index) })}>
        <Trash2 className="h-4 w-4 text-red-500" />
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t('staffMgmt.sso.title')} className="card max-h-[92vh] w-full max-w-4xl overflow-y-auto !p-0" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-subtle px-6 py-5">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold"><KeyRound className="h-5 w-5 text-primary-500" /> {t('staffMgmt.sso.title')}</h2>
            <p className="mt-1 text-sm text-muted">{t('staffMgmt.sso.subtitle')}</p>
          </div>
          <button className="icon-button border-0" onClick={onClose} aria-label={t('common.close')}><X className="h-5 w-5" /></button>
        </div>

        <div className="grid gap-6 p-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="space-y-3 text-sm">
            <ul className="space-y-1">
              {providers.map(p => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <button type="button" onClick={() => setForm(toForm(p))}
                    className={`min-w-0 flex-1 truncate rounded-control px-2 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-slate-800/50 ${form?.id === p.id ? 'bg-gray-100 dark:bg-slate-800' : ''}`}>
                    {p.name} <span className="text-xs uppercase text-muted">{p.type}</span>
                    {!p.isActive && <span className="ml-1 text-xs text-muted">({t('staffMgmt.sso.inactive')})</span>}
                  </button>
                  <button type="button" className="icon-button border-0" aria-label={t('common.delete')} onClick={() => void handleDelete(p)}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </button>
                </li>
              ))}
              {providers.length === 0 && <li className="text-xs text-muted">{t('staffMgmt.sso.none')}</li>}
            </ul>
            <button type="button" className="btn-secondary w-full text-sm" onClick={() => setForm({ ...emptyForm })}>
              <Plus className="mr-1 inline h-4 w-4" />{t('staffMgmt.sso.add')}
            </button>
            <label className="flex items-start gap-2 border-t border-subtle pt-3 text-xs">
              <input type="checkbox" className="mt-0.5" checked={!!settings?.localLoginDisabled} onChange={e => void toggleLocal(e.target.checked)} />
              <span>{t('staffMgmt.sso.localDisabled')}<span className="mt-1 block text-muted">{t('staffMgmt.sso.localDisabledHint')}</span></span>
            </label>
          </aside>

          {form ? (
            <form onSubmit={e => void handleSave(e)} className="space-y-4 text-sm">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium" htmlFor="idp-type">{t('staffMgmt.sso.type')}</label>
                  <select id="idp-type" className="input-field" value={form.type} onChange={e => set({ type: e.target.value as ProviderType, config: {} })}>
                    <option value="oidc">OpenID Connect</option>
                    <option value="saml">SAML 2.0</option>
                    <option value="ldap">LDAP / Active Directory</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium" htmlFor="idp-name">{t('staffMgmt.sso.name')}</label>
                  <input id="idp-name" required className="input-field" value={form.name} onChange={e => set({ name: e.target.value })} placeholder="Microsoft" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium" htmlFor="idp-slug">{t('staffMgmt.sso.slug')}</label>
                  <input id="idp-slug" required pattern="[a-z0-9-]{2,40}" className="input-field font-mono" value={form.slug} onChange={e => set({ slug: e.target.value.toLowerCase() })} placeholder="entra" />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {FIELDS[form.type].map(field => (
                  <div key={field.key} className={field.multiline ? 'sm:col-span-2' : ''}>
                    <label className="mb-1 block text-xs font-medium" htmlFor={`idp-${field.key}`}>{t(`staffMgmt.sso.fields.${field.key}`)}</label>
                    {field.multiline ? (
                      <textarea id={`idp-${field.key}`} rows={4} required={field.required} className="input-field font-mono text-xs"
                        value={form.config[field.key] ?? ''} placeholder={field.placeholder}
                        onChange={e => set({ config: { ...form.config, [field.key]: e.target.value } })} />
                    ) : (
                      <input id={`idp-${field.key}`} required={field.required} className="input-field font-mono text-xs"
                        value={form.config[field.key] ?? ''} placeholder={field.placeholder}
                        onChange={e => set({ config: { ...form.config, [field.key]: e.target.value } })} />
                    )}
                  </div>
                ))}
                {form.type !== 'saml' && (
                  <div>
                    <label className="mb-1 block text-xs font-medium" htmlFor="idp-secret">{form.type === 'ldap' ? t('staffMgmt.sso.bindPassword') : t('staffMgmt.sso.clientSecret')}</label>
                    <input id="idp-secret" type="password" autoComplete="new-password" className="input-field" value={form.secret}
                      required={!form.hasSecret} placeholder={form.hasSecret ? t('staffMgmt.sso.secretKept') : ''}
                      onChange={e => set({ secret: e.target.value })} />
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs font-medium" htmlFor="idp-domains">{t('staffMgmt.sso.allowedDomains')}</label>
                  <input id="idp-domains" className="input-field text-xs" value={form.allowedDomains} onChange={e => set({ allowedDomains: e.target.value })} placeholder="firma.com" />
                </div>
              </div>

              {form.type === 'ldap' && (
                <div className="flex flex-wrap gap-4 text-xs">
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.startTls} onChange={e => set({ startTls: e.target.checked })} /> StartTLS</label>
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.tlsRejectUnauthorized} onChange={e => set({ tlsRejectUnauthorized: e.target.checked })} /> {t('staffMgmt.sso.verifyTls')}</label>
                </div>
              )}

              {editing && form.type !== 'ldap' && (
                <div className="rounded-inset border border-subtle p-3 text-xs">
                  <p className="font-medium">{form.type === 'oidc' ? t('staffMgmt.sso.redirectUri') : t('staffMgmt.sso.samlUrls')}</p>
                  <code className="mt-1 block break-all">{form.type === 'oidc' ? editing.urls.redirectUri : `ACS: ${editing.urls.acsUrl}`}</code>
                  {form.type === 'saml' && <code className="block break-all">Metadata: {editing.urls.metadataUrl}</code>}
                </div>
              )}

              <div className="space-y-2 border-t border-subtle pt-3">
                <p className="text-xs font-medium">{t('staffMgmt.sso.roleMappings')}</p>
                <p className="text-xs text-muted">{t('staffMgmt.sso.roleMappingsHint')}</p>
                {form.roleMappings.map((m, i) => mappingRow('roleMappings', i, m))}
                <button type="button" className="btn-secondary text-xs" onClick={() => set({ roleMappings: [...form.roleMappings, { group: '', role: 'it_staff' }] })}>
                  <Plus className="mr-1 inline h-3.5 w-3.5" />{t('staffMgmt.sso.addMapping')}
                </button>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium">{t('staffMgmt.sso.companyMappings')}</p>
                <p className="text-xs text-muted">{t('staffMgmt.sso.companyMappingsHint')}</p>
                {form.companyMappings.map((m, i) => mappingRow('companyMappings', i, m))}
                <button type="button" className="btn-secondary text-xs" onClick={() => set({ companyMappings: [...form.companyMappings, { group: '', companyId: '' }] })}>
                  <Plus className="mr-1 inline h-3.5 w-3.5" />{t('staffMgmt.sso.addMapping')}
                </button>
              </div>

              <div className="space-y-2 border-t border-subtle pt-3 text-xs">
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.isActive} onChange={e => set({ isActive: e.target.checked })} /> {t('staffMgmt.sso.active')}</label>
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-0.5" checked={form.jitProvisioning} onChange={e => set({ jitProvisioning: e.target.checked })} />
                  <span>{t('staffMgmt.sso.jit')}<span className="block text-muted">{t('staffMgmt.sso.jitHint')}</span></span>
                </label>
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={() => setForm(null)}>{t('common.cancel')}</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-muted">{t('staffMgmt.sso.selectHint')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
