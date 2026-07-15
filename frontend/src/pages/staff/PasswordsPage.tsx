import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, Eye, Copy, Trash2, Pencil, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';

type Entry = {
  id: string; title: string; category?: string | null; url?: string | null;
  username?: string | null; companyId?: string | null; company?: { name: string } | null;
};

const empty = { title: '', category: '', url: '', username: '', password: '', notes: '', companyId: '' };

export default function PasswordsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const { data: entries } = useQuery<Entry[]>({
    queryKey: ['credentials'],
    queryFn: async () => (await api.get('/credentials')).data.data,
  });
  const { data: companies } = useQuery<any[]>({
    queryKey: ['companies-min'],
    queryFn: async () => (await api.get('/companies')).data.data,
  });

  const filtered = (entries || []).filter((e) =>
    [e.title, e.category, e.username, e.company?.name].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase()),
  );

  const reveal = async (id: string) => {
    try {
      const { password } = (await api.get(`/credentials/${id}/reveal`)).data.data;
      setRevealed((r) => ({ ...r, [id]: password }));
      setTimeout(() => setRevealed((r) => { const { [id]: _, ...rest } = r; return rest; }), 8000);
    } catch { toast.error('Şifre alınamadı'); }
  };

  const copy = async (id: string) => {
    try {
      const { password } = (await api.get(`/credentials/${id}/reveal`)).data.data;
      await navigator.clipboard.writeText(password);
      toast.success('Şifre kopyalandı');
    } catch { toast.error('Kopyalanamadı'); }
  };

  const openCreate = () => { setEditId(null); setForm({ ...empty }); setShowForm(true); };
  const openEdit = (e: Entry) => {
    setEditId(e.id);
    setForm({ title: e.title, category: e.category || '', url: e.url || '', username: e.username || '', password: '', notes: '', companyId: e.companyId || '' });
    setShowForm(true);
  };

  const save = async () => {
    const payload: any = {
      title: form.title, category: form.category || undefined, url: form.url || undefined,
      username: form.username || undefined, notes: form.notes || undefined,
      companyId: form.companyId || undefined,
    };
    if (form.password) payload.password = form.password;
    try {
      if (editId) await api.put(`/credentials/${editId}`, payload);
      else await api.post('/credentials', { ...payload, password: form.password });
      queryClient.invalidateQueries({ queryKey: ['credentials'] });
      setShowForm(false);
      toast.success('Kaydedildi');
    } catch { toast.error('Kaydedilemedi'); }
  };

  const remove = async (id: string) => {
    if (!confirm('Bu kaydı silmek istediğinize emin misiniz?')) return;
    try {
      await api.delete(`/credentials/${id}`);
      queryClient.invalidateQueries({ queryKey: ['credentials'] });
      toast.success('Silindi');
    } catch { toast.error('Silinemedi'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Şifreler</h1>
        <button onClick={openCreate} className="btn-primary text-sm flex items-center gap-1">
          <Plus className="w-4 h-4" /> Yeni Kayıt
        </button>
      </div>

      <label className="relative block max-w-sm">
        <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
        <input className="input-field !pl-8 text-sm" placeholder="Ara..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted border-b border-gray-200 dark:border-slate-800">
            <tr>
              <th className="px-4 py-2">Başlık</th>
              <th className="px-4 py-2">Kategori</th>
              <th className="px-4 py-2">Kullanıcı Adı</th>
              <th className="px-4 py-2">Şifre</th>
              <th className="px-4 py-2">Şirket</th>
              <th className="px-4 py-2 text-right">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id} className="border-b border-gray-100 dark:border-slate-800/60">
                <td className="px-4 py-2 font-medium">{e.title}</td>
                <td className="px-4 py-2 text-muted">{e.category || '-'}</td>
                <td className="px-4 py-2">{e.username || '-'}</td>
                <td className="px-4 py-2 font-mono">
                  {revealed[e.id] ? (
                    <span>{revealed[e.id]}</span>
                  ) : (
                    <button onClick={() => reveal(e.id)} className="inline-flex items-center gap-1 text-primary-600 hover:underline">
                      <Eye className="w-3.5 h-3.5" /> Göster
                    </button>
                  )}
                </td>
                <td className="px-4 py-2 text-muted">{e.company?.name || '-'}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => copy(e.id)} title="Kopyala" className="text-gray-500 hover:text-primary-600"><Copy className="w-4 h-4" /></button>
                    <button onClick={() => openEdit(e)} title="Düzenle" className="text-gray-500 hover:text-primary-600"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => remove(e.id)} title="Sil" className="text-gray-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted">Kayıt yok.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div className="card w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{editId ? 'Kaydı Düzenle' : 'Yeni Kayıt'}</h3>
              <button onClick={() => setShowForm(false)}><X className="w-5 h-5" /></button>
            </div>
            <input className="input-field text-sm" placeholder="Başlık (hizmet/servis adı)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <input className="input-field text-sm" placeholder="Kategori" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <select className="input-field text-sm" value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
              <option value="">Şirket (opsiyonel)</option>
              {(companies || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input className="input-field text-sm" placeholder="URL" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            <input className="input-field text-sm" placeholder="Kullanıcı adı" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            <input className="input-field text-sm" type="text" placeholder={editId ? 'Şifre (değiştirmek için doldurun)' : 'Şifre'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <textarea className="input-field text-sm" rows={2} placeholder="Not" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <div className="flex gap-2">
              <button className="btn-primary text-sm flex-1" onClick={save} disabled={!form.title || (!editId && !form.password)}>Kaydet</button>
              <button className="btn-secondary text-sm flex-1" onClick={() => setShowForm(false)}>İptal</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
