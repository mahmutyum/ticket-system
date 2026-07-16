import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus, Eye, EyeOff, Copy, Trash2, Pencil, Search, X,
  ArrowUpDown, ExternalLink, StickyNote, KeyRound, ShieldAlert,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { useAuthStore } from '../../stores/auth.store';
import { getApiError } from '../../utils/api-error';
import { PageHeader } from '../../components/ui/PageHeader';

type Entry = {
  id: string; title: string; category?: string | null; url?: string | null;
  username?: string | null; companyId?: string | null; company?: { name: string } | null;
  updatedAt?: string;
};

type CompanyOption = { id: string; name: string };

type CredentialPayload = {
  title: string;
  category?: string;
  url?: string;
  username?: string;
  password?: string;
  notes?: string;
  companyId?: string;
};

type SortKey = 'title' | 'category' | 'username' | 'company';

const empty = { title: '', category: '', url: '', username: '', password: '', notes: '', companyId: '' };

/** Şifre ekranda bu süre sonunda otomatik gizlenir. */
const REVEAL_SECONDS = 8;

/** Türkçe'ye duyarlı karşılaştırma — 'İ/ı' İngilizce toLowerCase ile bozulur. */
const tr = (s: string) => s.toLocaleLowerCase('tr');

/** Şirkete bağlı olmayan (companyId = null) kayıtları filtrelemek için sentinel. */
const GLOBAL_FILTER = '__global__';

export default function PasswordsPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'title', asc: true });
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [showPassword, setShowPassword] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, { value: string; expiresAt: number }>>({});
  const [now, setNow] = useState(() => Date.now());

  /** Açık gizleme zamanlayıcıları — unmount'ta temizlenir. */
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const { data: entries, isLoading, isError, refetch } = useQuery<Entry[]>({
    queryKey: ['credentials'],
    queryFn: async () => (await api.get('/credentials')).data.data,
  });

  // Şirket listesi kapsamlı uçtan gelir: it_manager yalnızca yetkili olduğu
  // şirketleri görmeli. Public /companies TÜM şirketleri döndürür ve burada
  // kullanılırsa yönetici kaydedemeyeceği şirketleri seçebilir.
  const { data: companies } = useQuery<CompanyOption[]>({
    queryKey: ['companies-scoped'],
    queryFn: async () => {
      const rows = (await api.get('/companies/admin/all')).data.data;
      return (rows as CompanyOption[]).map(({ id, name }) => ({ id, name }));
    },
  });

  // Şifre görünürken saniye sayacını canlı tut.
  const hasRevealed = Object.keys(revealed).length > 0;
  useEffect(() => {
    if (!hasRevealed) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [hasRevealed]);

  // Sayfadan çıkarken zamanlayıcıları temizle ve çözülmüş şifreleri bellekten düşür.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      Object.values(pending).forEach(clearTimeout);
      setRevealed({});
    };
  }, []);

  const categories = useMemo(
    () => Array.from(new Set((entries || []).map((e) => e.category).filter(Boolean) as string[])).sort(),
    [entries],
  );

  const visible = useMemo(() => {
    const q = tr(search.trim());
    const rows = (entries || []).filter((e) => {
      if (companyFilter === GLOBAL_FILTER) { if (e.companyId) return false; }
      else if (companyFilter && e.companyId !== companyFilter) return false;
      if (categoryFilter && (e.category || '') !== categoryFilter) return false;
      if (!q) return true;
      return [e.title, e.category, e.username, e.url, e.company?.name]
        .filter(Boolean)
        .some((f) => tr(String(f)).includes(q));
    });

    const val = (e: Entry) =>
      sort.key === 'company' ? e.company?.name || '' : (e[sort.key] as string) || '';
    return [...rows].sort((a, b) => {
      const r = val(a).localeCompare(val(b), 'tr', { sensitivity: 'base' });
      return sort.asc ? r : -r;
    });
  }, [entries, search, companyFilter, categoryFilter, sort]);

  const hide = (id: string) => {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    setRevealed((r) => { const { [id]: _drop, ...rest } = r; return rest; });
  };

  const reveal = async (id: string) => {
    try {
      const { password } = (await api.get(`/credentials/${id}/reveal`)).data.data;
      setRevealed((r) => ({ ...r, [id]: { value: password, expiresAt: Date.now() + REVEAL_SECONDS * 1000 } }));
      clearTimeout(timers.current[id]);
      timers.current[id] = setTimeout(() => hide(id), REVEAL_SECONDS * 1000);
    } catch (err: unknown) {
      toast.error(getApiError(err, 'Şifre alınamadı'));
    }
  };

  const copy = async (id: string) => {
    try {
      // Zaten görünür durumdaysa tekrar sunucuya gitme (her istek audit log yazar).
      const value = revealed[id]?.value ?? (await api.get(`/credentials/${id}/reveal`)).data.data.password;
      if (!navigator.clipboard) {
        toast.error('Panoya kopyalama yalnızca HTTPS bağlantıda çalışır');
        return;
      }
      await navigator.clipboard.writeText(value);
      toast.success('Şifre kopyalandı');
    } catch (err: unknown) {
      toast.error(getApiError(err, 'Kopyalanamadı'));
    }
  };

  const openCreate = () => {
    setEditId(null);
    setForm({ ...empty, companyId: !isAdmin && companies?.length === 1 ? companies[0].id : '' });
    setShowPassword(false);
    setShowForm(true);
  };

  const openEdit = (e: Entry) => {
    setEditId(e.id);
    setForm({
      title: e.title, category: e.category || '', url: e.url || '',
      username: e.username || '', password: '', notes: '', companyId: e.companyId || '',
    });
    setShowPassword(false);
    setShowForm(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: CredentialPayload = {
        title: form.title.trim(),
        category: form.category.trim() || undefined,
        url: form.url.trim() || undefined,
        username: form.username.trim() || undefined,
        notes: form.notes || undefined,
        companyId: form.companyId || undefined,
      };
      if (form.password) payload.password = form.password;
      if (editId) await api.put(`/credentials/${editId}`, payload);
      else await api.post('/credentials', { ...payload, password: form.password });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credentials'] });
      setShowForm(false);
      toast.success('Kaydedildi');
    },
    onError: (err: unknown) => toast.error(getApiError(err, 'Kaydedilemedi')),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/credentials/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credentials'] });
      toast.success('Silindi');
    },
    onError: (err: unknown) => toast.error(getApiError(err, 'Silinemedi')),
  });

  // Escape ile kapat
  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowForm(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm]);

  // it_manager global (şirketsiz) kayıt oluşturamaz — sunucu da reddeder.
  const companyRequired = !isAdmin;
  const canSave =
    form.title.trim().length > 0 &&
    (editId || form.password.length > 0) &&
    (!companyRequired || !!form.companyId);

  const SortHeader = ({ k, label }: { k: SortKey; label: string }) => (
    <th className="px-4 py-2 font-medium">
      <button
        onClick={() => setSort((s) => ({ key: k, asc: s.key === k ? !s.asc : true }))}
        className="inline-flex items-center gap-1 hover:text-primary-600 transition-colors"
      >
        {label}
        <ArrowUpDown className={`w-3 h-3 ${sort.key === k ? 'text-primary-600' : 'opacity-40'}`} />
      </button>
    </th>
  );

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Güvenli kasa" title="Şifreler" description={isAdmin
        ? 'Tüm kayıtlar. Her görüntüleme denetim kaydına yazılır.'
        : 'Yetkili olduğunuz şirketlerin kayıtları. Her görüntüleme denetim kaydına yazılır.'} actions={
        <button onClick={openCreate} className="btn-primary text-sm flex items-center gap-1">
          <Plus className="w-4 h-4" /> Yeni Kayıt
        </button>
      } />

      {/* Filtreler */}
      <div className="card flex flex-wrap items-center gap-2 p-4">
        <label className="relative block flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input-field !pl-8 text-sm w-full"
            placeholder="Başlık, kullanıcı adı, URL veya şirket ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select className="input-field text-sm w-auto" value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}>
          <option value="">Tüm şirketler</option>
          {/* Global kayıtları (companyId = null) yalnızca admin görebilir. */}
          {isAdmin && <option value={GLOBAL_FILTER}>Global (şirketsiz)</option>}
          {(companies || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input-field text-sm w-auto" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">Tüm kategoriler</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {(search || companyFilter || categoryFilter) && (
          <button
            onClick={() => { setSearch(''); setCompanyFilter(''); setCategoryFilter(''); }}
            className="text-sm text-muted hover:text-primary-600 inline-flex items-center gap-1"
          >
            <X className="w-3.5 h-3.5" /> Temizle
          </button>
        )}
        <span className="text-sm text-muted ml-auto">{visible.length} kayıt</span>
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="text-left text-muted border-b border-gray-200 dark:border-slate-800">
            <tr>
              <SortHeader k="title" label="Başlık" />
              <SortHeader k="category" label="Kategori" />
              <SortHeader k="username" label="Kullanıcı Adı" />
              <th className="px-4 py-2 font-medium">Şifre</th>
              <SortHeader k="company" label="Şirket" />
              <th className="px-4 py-2 font-medium text-right">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              // Yükleme durumu ayrı ele alınır — yoksa boş liste "Kayıt yok" gibi görünür.
              [...Array(4)].map((_, i) => (
                <tr key={i} className="border-b border-gray-100 dark:border-slate-800/60">
                  <td colSpan={6} className="px-4 py-3">
                    <div className="h-4 bg-gray-100 dark:bg-slate-800 rounded animate-pulse" />
                  </td>
                </tr>
              ))
            )}

            {isError && !isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center">
                  <ShieldAlert className="w-6 h-6 mx-auto mb-2 text-red-500" />
                  <p className="text-muted mb-2">Kayıtlar yüklenemedi.</p>
                  <button onClick={() => refetch()} className="btn-secondary text-sm">Tekrar dene</button>
                </td>
              </tr>
            )}

            {!isLoading && !isError && visible.map((e) => {
              const shown = revealed[e.id];
              const left = shown ? Math.max(0, Math.ceil((shown.expiresAt - now) / 1000)) : 0;
              return (
                <tr key={e.id} className="border-b border-gray-100 dark:border-slate-800/60 hover:bg-gray-50 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{e.title}</span>
                      {e.url && (
                        <a
                          href={e.url} target="_blank" rel="noopener noreferrer"
                          title={e.url}
                          className="text-gray-400 hover:text-primary-600"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-muted">{e.category || '-'}</td>
                  <td className="px-4 py-2">{e.username || '-'}</td>
                  <td className="px-4 py-2">
                    {shown ? (
                      <div className="flex items-center gap-2">
                        <span className="font-mono select-all">{shown.value}</span>
                        <button onClick={() => hide(e.id)} title="Gizle" className="text-gray-400 hover:text-primary-600">
                          <EyeOff className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-xs text-muted tabular-nums">{left}sn</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => reveal(e.id)}
                        className="inline-flex items-center gap-1.5 text-primary-600 hover:underline"
                        title="Şifreyi göster (denetim kaydına yazılır)"
                      >
                        <span className="font-mono tracking-widest text-gray-400">••••••••</span>
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted">
                    {e.company?.name || (
                      <span className="inline-flex items-center gap-1 text-xs" title="Şirkete bağlı değil — yalnızca sistem yöneticisi görebilir">
                        <KeyRound className="w-3 h-3" /> Global
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => copy(e.id)} title="Şifreyi kopyala" aria-label="Şifreyi kopyala" className="text-gray-500 hover:text-primary-600"><Copy className="w-4 h-4" /></button>
                      <button onClick={() => openEdit(e)} title="Düzenle" aria-label="Düzenle" className="text-gray-500 hover:text-primary-600"><Pencil className="w-4 h-4" /></button>
                      <button
                        onClick={() => { if (confirm(`"${e.title}" kaydını silmek istediğinize emin misiniz?`)) removeMutation.mutate(e.id); }}
                        title="Sil" aria-label="Sil"
                        className="text-gray-500 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {!isLoading && !isError && visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  {entries?.length ? 'Filtrelerle eşleşen kayıt yok.' : 'Henüz kayıt yok.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div
            role="dialog" aria-modal="true" aria-label={editId ? 'Kaydı düzenle' : 'Yeni kayıt'}
            className="card w-full max-w-md space-y-3 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{editId ? 'Kaydı Düzenle' : 'Yeni Kayıt'}</h3>
              <button onClick={() => setShowForm(false)} aria-label="Kapat"><X className="w-5 h-5" /></button>
            </div>

            <form
              className="space-y-3"
              onSubmit={(e) => { e.preventDefault(); if (canSave) saveMutation.mutate(); }}
            >
              <input className="input-field text-sm" placeholder="Başlık (hizmet/servis adı) *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus />
              <input className="input-field text-sm" placeholder="Kategori" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />

              <div>
                <select className="input-field text-sm" value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
                  <option value="">{companyRequired ? 'Şirket seçin *' : 'Şirket (boş = global, yalnızca yöneticiler)'}</option>
                  {(companies || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {companyRequired && !form.companyId && (
                  <p className="text-xs text-muted mt-1">Yalnızca yetkili olduğunuz bir şirket için kayıt ekleyebilirsiniz.</p>
                )}
              </div>

              <input className="input-field text-sm" placeholder="URL" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
              <input className="input-field text-sm" placeholder="Kullanıcı adı" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />

              <div className="relative">
                <input
                  className="input-field text-sm !pr-9"
                  // Varsayılan gizli: omuz sörfüne ve tarayıcı otomatik doldurmasına karşı.
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder={editId ? 'Şifre (değiştirmek için doldurun)' : 'Şifre *'}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-primary-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <div>
                <textarea className="input-field text-sm" rows={2} placeholder="Not" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                {editId && (
                  <p className="text-xs text-muted mt-1 inline-flex items-center gap-1">
                    <StickyNote className="w-3 h-3" /> Not alanı güvenlik gereği yüklenmez; doldurursan mevcut notun üzerine yazılır.
                  </p>
                )}
              </div>

              <div className="flex gap-2 pt-1">
                <button type="submit" className="btn-primary text-sm flex-1" disabled={!canSave || saveMutation.isPending}>
                  {saveMutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}
                </button>
                <button type="button" className="btn-secondary text-sm flex-1" onClick={() => setShowForm(false)}>İptal</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
