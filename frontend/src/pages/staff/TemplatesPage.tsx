import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2, Mail, MessageSquare, MessageCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';

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

  const { data: emailTemplates } = useQuery({
    queryKey: ['templates-email'],
    queryFn: async () => (await api.get('/templates/email')).data.data,
  });

  const { data: smsTemplates } = useQuery({
    queryKey: ['templates-sms'],
    queryFn: async () => (await api.get('/templates/sms')).data.data,
  });

  const { data: cannedResponses } = useQuery({
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
      toast.success('Email şablonu kaydedildi');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Hata');
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
      toast.success('SMS şablonu kaydedildi');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Hata');
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
      toast.success('Hazır yanıt kaydedildi');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Hata');
    }
  };

  const handleDelete = async (type: TabType, id: string) => {
    if (!confirm('Silmek istediğinize emin misiniz?')) return;
    try {
      await api.delete(`/templates/${type}/${id}`);
      queryClient.invalidateQueries({ queryKey: [`templates-${type}`] });
      toast.success('Silindi');
    } catch {
      toast.error('Silinemedi');
    }
  };

  const tabs = [
    { key: 'email' as TabType, label: 'Email Şablonları', icon: Mail },
    { key: 'sms' as TabType, label: 'SMS Şablonları', icon: MessageSquare },
    { key: 'canned' as TabType, label: 'Hazır Yanıtlar', icon: MessageCircle },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Şablon Yönetimi</h1>
        <button
          onClick={() => { setShowForm(true); setEditId(null); }}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Yeni Ekle
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); resetForms(); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-white shadow text-primary-700' : 'text-gray-500 hover:text-gray-700 dark:hover:text-slate-300'
            }`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold mb-4">
              {editId ? 'Düzenle' : 'Yeni'} — {tabs.find(t => t.key === tab)?.label}
            </h2>

            {tab === 'email' && (
              <form onSubmit={handleSubmitEmail} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Slug (benzersiz anahtar) *</label>
                  <input type="text" className="input-field" value={emailForm.slug} onChange={e => setEmailForm({ ...emailForm, slug: e.target.value })} required disabled={!!editId} placeholder="ticket_created" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Konu *</label>
                  <input type="text" className="input-field" value={emailForm.subject} onChange={e => setEmailForm({ ...emailForm, subject: e.target.value })} required />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">HTML İçerik *</label>
                  <textarea className="input-field min-h-[150px] font-mono text-sm" value={emailForm.bodyHtml} onChange={e => setEmailForm({ ...emailForm, bodyHtml: e.target.value })} required />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Düz Metin *</label>
                  <textarea className="input-field min-h-[80px]" value={emailForm.bodyText} onChange={e => setEmailForm({ ...emailForm, bodyText: e.target.value })} required />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Değişkenler (virgülle ayırın)</label>
                  <input type="text" className="input-field" value={emailForm.variables} onChange={e => setEmailForm({ ...emailForm, variables: e.target.value })} placeholder="ticketNumber, userName, trackingUrl" />
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="submit" className="btn-primary flex-1">Kaydet</button>
                  <button type="button" onClick={resetForms} className="btn-secondary flex-1">İptal</button>
                </div>
              </form>
            )}

            {tab === 'sms' && (
              <form onSubmit={handleSubmitSms} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Slug *</label>
                  <input type="text" className="input-field" value={smsForm.slug} onChange={e => setSmsForm({ ...smsForm, slug: e.target.value })} required disabled={!!editId} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Mesaj *</label>
                  <textarea className="input-field min-h-[100px]" value={smsForm.body} onChange={e => setSmsForm({ ...smsForm, body: e.target.value })} required />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Değişkenler</label>
                  <input type="text" className="input-field" value={smsForm.variables} onChange={e => setSmsForm({ ...smsForm, variables: e.target.value })} />
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="submit" className="btn-primary flex-1">Kaydet</button>
                  <button type="button" onClick={resetForms} className="btn-secondary flex-1">İptal</button>
                </div>
              </form>
            )}

            {tab === 'canned' && (
              <form onSubmit={handleSubmitCanned} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Başlık *</label>
                  <input type="text" className="input-field" value={cannedForm.title} onChange={e => setCannedForm({ ...cannedForm, title: e.target.value })} required />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">İçerik *</label>
                  <textarea className="input-field min-h-[100px]" value={cannedForm.content} onChange={e => setCannedForm({ ...cannedForm, content: e.target.value })} required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Kategori</label>
                    <input type="text" className="input-field" value={cannedForm.category} onChange={e => setCannedForm({ ...cannedForm, category: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Sıra</label>
                    <input type="number" className="input-field" value={cannedForm.sortOrder} onChange={e => setCannedForm({ ...cannedForm, sortOrder: parseInt(e.target.value) || 0 })} />
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="submit" className="btn-primary flex-1">Kaydet</button>
                  <button type="button" onClick={resetForms} className="btn-secondary flex-1">İptal</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      {tab === 'email' && (
        <div className="space-y-3">
          {emailTemplates?.map((t: any) => (
            <div key={t.id} className="card">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <code className="text-xs bg-gray-100 px-2 py-0.5 rounded">{t.slug}</code>
                  </div>
                  <h3 className="font-medium">{t.subject}</h3>
                  <p className="text-xs text-gray-400 mt-1">Değişkenler: {parseVariables(t.variables).join(', ') || '-'}</p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => {
                      setEditId(t.id);
                      setEmailForm({ slug: t.slug, subject: t.subject, bodyHtml: t.bodyHtml, bodyText: t.bodyText, variables: parseVariables(t.variables).join(', ') || '' });
                      setShowForm(true);
                    }}
                    className="p-1.5 hover:bg-gray-100 rounded"
                  >
                    <Edit2 className="w-4 h-4 text-gray-500" />
                  </button>
                  <button onClick={() => handleDelete('email', t.id)} className="p-1.5 hover:bg-red-50 rounded">
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
          {smsTemplates?.map((t: any) => (
            <div key={t.id} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <code className="text-xs bg-gray-100 px-2 py-0.5 rounded">{t.slug}</code>
                  <p className="mt-2 text-sm">{t.body}</p>
                  <p className="text-xs text-gray-400 mt-1">Değişkenler: {parseVariables(t.variables).join(', ') || '-'}</p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => {
                      setEditId(t.id);
                      setSmsForm({ slug: t.slug, body: t.body, variables: parseVariables(t.variables).join(', ') || '' });
                      setShowForm(true);
                    }}
                    className="p-1.5 hover:bg-gray-100 rounded"
                  >
                    <Edit2 className="w-4 h-4 text-gray-500" />
                  </button>
                  <button onClick={() => handleDelete('sms', t.id)} className="p-1.5 hover:bg-red-50 rounded">
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
          {cannedResponses?.map((cr: any) => (
            <div key={cr.id} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{cr.title}</h3>
                    {cr.category && <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">{cr.category}</span>}
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
                    className="p-1.5 hover:bg-gray-100 rounded"
                  >
                    <Edit2 className="w-4 h-4 text-gray-500" />
                  </button>
                  <button onClick={() => handleDelete('canned', cr.id)} className="p-1.5 hover:bg-red-50 rounded">
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
