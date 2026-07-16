import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2, Mail, MessageSquare, MessageCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { getApiError } from '../../utils/api-error';
import type { CannedResponse, EmailTemplate, SmsTemplate } from '../../types';
import { PageHeader } from '../../components/ui/PageHeader';

type TabType = 'email' | 'sms' | 'canned';

function parseVariables(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // not JSON, treat as comma-separated fallback
      return value.split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  return [];
}

export default function TemplatesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabType>('email');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // Email form
  const [emailForm, setEmailForm] = useState({ slug: '', subject: '', bodyHtml: '', bodyText: '', variables: '' });
  // SMS form
  const [smsForm, setSmsForm] = useState({ slug: '', body: '', variables: '' });
  // Canned form
  const [cannedForm, setCannedForm] = useState({ title: '', content: '', category: '', sortOrder: 0 });

  const { data: emailTemplates } = useQuery<EmailTemplate[]>({
    queryKey: ['templates-email'],
    queryFn: async () => (await api.get('/templates/email')).data.data,
  });

  const { data: smsTemplates } = useQuery<SmsTemplate[]>({
    queryKey: ['templates-sms'],
    queryFn: async () => (await api.get('/templates/sms')).data.data,
  });

  const { data: cannedResponses } = useQuery<CannedResponse[]>({
    queryKey: ['templates-canned'],
    queryFn: async () => (await api.get('/templates/canned')).data.data,
  });

  const resetForms = () => {
    setEmailForm({ slug: '', subject: '', bodyHtml: '', bodyText: '', variables: '' });
    setSmsForm({ slug: '', body: '', variables: '' });
    setCannedForm({ title: '', content: '', category: '', sortOrder: 0 });
    setShowForm(false);
    setEditId(null);
  };

  const handleSubmitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        ...emailForm,
        variables: emailForm.variables.split(',').map(v => v.trim()).filter(Boolean),
      };
      if (editId) {
        await api.put(`/templates/email/${editId}`, payload);
      } else {
        await api.post('/templates/email', payload);
      }
      queryClient.invalidateQueries({ queryKey: ['templates-email'] });
      resetForms();
      toast.success(t('templates.emailSaved'));
    } catch (err: unknown) {
      toast.error(getApiError(err, t('templates.saveError')));
    }
  };

  const handleSubmitSms = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        ...smsForm,
        variables: smsForm.variables.split(',').map(v => v.trim()).filter(Boolean),
      };
      if (editId) {
        await api.put(`/templates/sms/${editId}`, payload);
      } else {
        await api.post('/templates/sms', payload);
      }
      queryClient.invalidateQueries({ queryKey: ['templates-sms'] });
      resetForms();
      toast.success(t('templates.smsSaved'));
    } catch (err: unknown) {
      toast.error(getApiError(err, t('templates.saveError')));
    }
  };

  const handleSubmitCanned = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editId) {
        await api.put(`/templates/canned/${editId}`, cannedForm);
      } else {
        await api.post('/templates/canned', cannedForm);
      }
      queryClient.invalidateQueries({ queryKey: ['templates-canned'] });
      resetForms();
      toast.success(t('templates.cannedSaved'));
    } catch (err: unknown) {
      toast.error(getApiError(err, t('templates.saveError')));
    }
  };

  const handleDelete = async (type: TabType, id: string) => {
    if (!confirm(t('common.confirmDelete'))) return;
    try {
      await api.delete(`/templates/${type}/${id}`);
      queryClient.invalidateQueries({ queryKey: [`templates-${type}`] });
      toast.success(t('templates.deleted'));
    } catch {
      toast.error(t('templates.deleteError'));
    }
  };

  const tabs = [
    { key: 'email' as TabType, label: t('templates.tabEmail'), icon: Mail },
    { key: 'sms' as TabType, label: t('templates.tabSms'), icon: MessageSquare },
    { key: 'canned' as TabType, label: t('templates.tabCanned'), icon: MessageCircle },
  ];

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={t('templates.eyebrow')} title={t('templates.title')} description={t('templates.description')} actions={
        <button
          onClick={() => { setShowForm(true); setEditId(null); }}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> {t('templates.addNew')}
        </button>
      } />

      {/* Tabs */}
      <div className="surface-2 flex gap-1 overflow-x-auto rounded-xl p-1">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); resetForms(); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-white shadow text-primary-700 dark:bg-slate-700 dark:text-primary-300' : 'text-gray-500 hover:text-gray-700 dark:text-slate-300 dark:hover:text-white'
            }`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold mb-4">
              {editId ? t('common.edit') : t('common.new')} — {tabs.find(x => x.key === tab)?.label}
            </h2>

            {tab === 'email' && (
              <form onSubmit={handleSubmitEmail} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">{t('templates.emailSlugLabel')} *</label>
                  <input type="text" className="input-field" value={emailForm.slug} onChange={e => setEmailForm({ ...emailForm, slug: e.target.value })} required disabled={!!editId} placeholder="ticket_created" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('common.subject')} *</label>
                  <input type="text" className="input-field" value={emailForm.subject} onChange={e => setEmailForm({ ...emailForm, subject: e.target.value })} required />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('templates.htmlContent')} *</label>
                  <textarea className="input-field min-h-[150px] font-mono text-sm" value={emailForm.bodyHtml} onChange={e => setEmailForm({ ...emailForm, bodyHtml: e.target.value })} required />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('templates.plainText')} *</label>
                  <textarea className="input-field min-h-[80px]" value={emailForm.bodyText} onChange={e => setEmailForm({ ...emailForm, bodyText: e.target.value })} required />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('templates.variablesComma')}</label>
                  <input type="text" className="input-field" value={emailForm.variables} onChange={e => setEmailForm({ ...emailForm, variables: e.target.value })} placeholder="ticketNumber, userName, trackingUrl" />
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="submit" className="btn-primary flex-1">{t('common.save')}</button>
                  <button type="button" onClick={resetForms} className="btn-secondary flex-1">{t('common.cancel')}</button>
                </div>
              </form>
            )}

            {tab === 'sms' && (
              <form onSubmit={handleSubmitSms} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">{t('templates.slug')} *</label>
                  <input type="text" className="input-field" value={smsForm.slug} onChange={e => setSmsForm({ ...smsForm, slug: e.target.value })} required disabled={!!editId} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('templates.message')} *</label>
                  <textarea className="input-field min-h-[100px]" value={smsForm.body} onChange={e => setSmsForm({ ...smsForm, body: e.target.value })} required />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('templates.variables')}</label>
                  <input type="text" className="input-field" value={smsForm.variables} onChange={e => setSmsForm({ ...smsForm, variables: e.target.value })} />
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="submit" className="btn-primary flex-1">{t('common.save')}</button>
                  <button type="button" onClick={resetForms} className="btn-secondary flex-1">{t('common.cancel')}</button>
                </div>
              </form>
            )}

            {tab === 'canned' && (
              <form onSubmit={handleSubmitCanned} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">{t('templates.cannedTitle')} *</label>
                  <input type="text" className="input-field" value={cannedForm.title} onChange={e => setCannedForm({ ...cannedForm, title: e.target.value })} required />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('templates.content')} *</label>
                  <textarea className="input-field min-h-[100px]" value={cannedForm.content} onChange={e => setCannedForm({ ...cannedForm, content: e.target.value })} required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">{t('common.category')}</label>
                    <input type="text" className="input-field" value={cannedForm.category} onChange={e => setCannedForm({ ...cannedForm, category: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">{t('templates.sortOrder')}</label>
                    <input type="number" className="input-field" value={cannedForm.sortOrder} onChange={e => setCannedForm({ ...cannedForm, sortOrder: parseInt(e.target.value) || 0 })} />
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="submit" className="btn-primary flex-1">{t('common.save')}</button>
                  <button type="button" onClick={resetForms} className="btn-secondary flex-1">{t('common.cancel')}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      {tab === 'email' && (
        <div className="space-y-3">
          {emailTemplates?.map(tpl => (
            <div key={tpl.id} className="card">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <code className="surface-2 rounded px-2 py-0.5 text-xs">{tpl.slug}</code>
                  </div>
                  <h3 className="font-medium">{tpl.subject}</h3>
                  <p className="mt-1 text-xs text-muted">{t('templates.variablesList', { list: parseVariables(tpl.variables).join(', ') || '-' })}</p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => {
                      setEditId(tpl.id);
                      setEmailForm({ slug: tpl.slug, subject: tpl.subject, bodyHtml: tpl.bodyHtml, bodyText: tpl.bodyText, variables: parseVariables(tpl.variables).join(', ') || '' });
                      setShowForm(true);
                    }}
                    aria-label={t('templates.editEmailAria', { subject: tpl.subject })}
                    className="icon-button border-0"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button aria-label={t('templates.deleteEmailAria', { subject: tpl.subject })} onClick={() => handleDelete('email', tpl.id)} className="icon-button border-0 text-red-500 hover:text-red-600">
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'sms' && (
        <div className="space-y-3">
          {smsTemplates?.map(tpl => (
            <div key={tpl.id} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <code className="surface-2 rounded px-2 py-0.5 text-xs">{tpl.slug}</code>
                  <p className="mt-2 text-sm">{tpl.body}</p>
                  <p className="mt-1 text-xs text-muted">{t('templates.variablesList', { list: parseVariables(tpl.variables).join(', ') || '-' })}</p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => {
                      setEditId(tpl.id);
                      setSmsForm({ slug: tpl.slug, body: tpl.body, variables: parseVariables(tpl.variables).join(', ') || '' });
                      setShowForm(true);
                    }}
                    aria-label={t('templates.editSmsAria', { slug: tpl.slug })}
                    className="icon-button border-0"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button aria-label={t('templates.deleteSmsAria', { slug: tpl.slug })} onClick={() => handleDelete('sms', tpl.id)} className="icon-button border-0 text-red-500 hover:text-red-600">
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'canned' && (
        <div className="space-y-3">
          {cannedResponses?.map(cr => (
            <div key={cr.id} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{cr.title}</h3>
                    {cr.category && <span className="surface-2 rounded px-2 py-0.5 text-xs">{cr.category}</span>}
                  </div>
                  <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">{cr.content}</p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => {
                      setEditId(cr.id);
                      setCannedForm({ title: cr.title, content: cr.content, category: cr.category || '', sortOrder: cr.sortOrder });
                      setShowForm(true);
                    }}
                    aria-label={t('templates.editCannedAria', { title: cr.title })}
                    className="icon-button border-0"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button aria-label={t('templates.deleteCannedAria', { title: cr.title })} onClick={() => handleDelete('canned', cr.id)} className="icon-button border-0 text-red-500 hover:text-red-600">
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
