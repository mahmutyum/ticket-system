import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Edit2, Trash2, Users, Clock, AlertCircle, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { useAuthStore } from '../../stores/auth.store';
// Öncelik sözlüğü ticket'larla ORTAK — burada kopyalama, tek kaynaktan al.
import { PRIORITY_LABELS as PRIORITY_LABEL, PRIORITY_COLORS as PRIORITY_COLOR, PRIORITY_WEIGHT } from '../../types';
import type { Company, Location, Staff, Task } from '../../types';
import { getApiError } from '../../utils/api-error';

// Durum sözlüğü göreve özgüdür (ticket'ın 9 durumundan farklı).
const STATUS_LABEL: Record<string, string> = {
  open: 'Açık',
  in_progress: 'Devam Ediyor',
  done: 'Tamamlandı',
  cancelled: 'İptal',
};

// Karanlık modda okunabilirlik için her rozetin dark: karşılığı olmalı — aksi
// halde açık zemin + koyu metin karanlık temada düşük kontrastta kalır.
const STATUS_COLOR: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
  in_progress: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300',
  done: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
  cancelled: 'bg-gray-200 text-gray-600 dark:bg-slate-700/60 dark:text-slate-400',
};

type SortKey = 'dueDate' | 'priority' | 'createdAt' | 'title';
type TaskScope = 'all' | 'assigned' | 'created';

interface TaskPayload {
  title: string;
  description: string;
  priority: string;
  assigneeIds: string[];
  locationId?: string;
  dueDate: string | null;
}

const SORT_LABEL: Record<SortKey, string> = {
  dueDate: 'Bitiş tarihi (yakın önce)',
  priority: 'Öncelik (acil önce)',
  createdAt: 'Oluşturma (yeni önce)',
  title: 'Başlık (A-Z)',
};

const isOverdue = (t: Task) =>
  !!t.dueDate && t.status !== 'done' && t.status !== 'cancelled' && new Date(t.dueDate) < new Date();

/** Türkçe'ye duyarlı arama — 'İ/ı' İngilizce toLowerCase ile bozulur. */
const tr = (s: string) => s.toLocaleLowerCase('tr');

interface FormState {
  title: string;
  description: string;
  priority: string;
  dueDate: string;
  assigneeIds: string[];
  companyId: string;
  locationId: string;
}

const emptyForm: FormState = {
  title: '',
  description: '',
  priority: 'medium',
  dueDate: '',
  assigneeIds: [],
  companyId: '',
  locationId: '',
};

function daysOpen(createdAt: string, completedAt?: string | null): number {
  const start = new Date(createdAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  return Math.max(0, Math.floor((end - start) / (1000 * 60 * 60 * 24)));
}

export default function TasksPage() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const isManager = user?.role === 'admin' || user?.role === 'it_manager';

  // scope ve statusFilter sunucuya gider; aşağıdakiler istemci tarafında uygulanır
  // (liste sayfalanmadığı için tamamı zaten bellekte).
  const [scope, setScope] = useState<TaskScope>(isManager ? 'all' : 'assigned');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('dueDate');

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const { data: tasks, isLoading } = useQuery<Task[]>({
    queryKey: ['tasks', scope, statusFilter],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (scope !== 'all') params.scope = scope;
      if (statusFilter) params.status = statusFilter;
      const qs = new URLSearchParams(params).toString();
      return (await api.get(`/tasks${qs ? `?${qs}` : ''}`)).data.data;
    },
  });

  const { data: staffList } = useQuery<Staff[]>({
    queryKey: ['staff-all'],
    queryFn: async () => (await api.get('/staff')).data.data,
    enabled: isManager,
  });

  const { data: companies } = useQuery<Company[]>({
    queryKey: ['companies-active'],
    queryFn: async () => (await api.get('/companies')).data.data,
    enabled: isManager,
  });

  const { data: locations } = useQuery<Location[]>({
    queryKey: ['locations-by-company', form.companyId],
    queryFn: async () => (await api.get(`/companies/${form.companyId}/locations`)).data.data,
    enabled: isManager && !!form.companyId,
  });

  const update = (fields: Partial<FormState>) => setForm(prev => ({ ...prev, ...fields }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.assigneeIds.length === 0) {
      toast.error('En az bir personel seçmelisiniz');
      return;
    }
    if (!editId && !form.locationId) {
      toast.error('Lokasyon seçmelisiniz');
      return;
    }
    try {
      const payload: TaskPayload = {
        title: form.title,
        description: form.description,
        priority: form.priority,
        assigneeIds: form.assigneeIds,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
      };
      if (form.locationId) payload.locationId = form.locationId;

      if (editId) {
        await api.put(`/tasks/${editId}`, payload);
        toast.success('Görev güncellendi');
      } else {
        await api.post('/tasks', payload);
        toast.success('Görev oluşturuldu ve atananlara bildirim gönderildi');
      }
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setShowForm(false);
      setEditId(null);
      setForm(emptyForm);
    } catch (err: unknown) {
      toast.error(getApiError(err, 'İşlem başarısız'));
    }
  };

  const handleEdit = (t: Task) => {
    setEditId(t.id);
    setForm({
      title: t.title,
      description: t.description,
      priority: t.priority,
      dueDate: t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 16) : '',
      assigneeIds: t.assignees.map(a => a.staff.id),
      companyId: t.location?.company?.id || '',
      locationId: t.location?.id || '',
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Bu görevi silmek istediğinizden emin misiniz?')) return;
    try {
      await api.delete(`/tasks/${id}`);
      toast.success('Görev silindi');
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    } catch {
      toast.error('Silme başarısız');
    }
  };

  const handleStatus = async (id: string, status: string) => {
    try {
      await api.patch(`/tasks/${id}/status`, { status });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast.success('Durum güncellendi');
    } catch {
      toast.error('Güncelleme başarısız');
    }
  };

  const toggleAssignee = (id: string) => {
    update({
      assigneeIds: form.assigneeIds.includes(id)
        ? form.assigneeIds.filter(x => x !== id)
        : [...form.assigneeIds, id],
    });
  };

  // İstatistikler sunucudan gelen kümenin tamamını anlatır; istemci filtreleri
  // bunu daraltmaz. Böylece kutucuklar filtre açıkken de doğru toplamı gösterir
  // ve filtreye tıklama kısayolu olarak kullanılabilir.
  const stats = useMemo(() => {
    const list = tasks || [];
    return {
      total: list.length,
      open: list.filter(t => t.status === 'open').length,
      inProgress: list.filter(t => t.status === 'in_progress').length,
      done: list.filter(t => t.status === 'done').length,
      overdue: list.filter(isOverdue).length,
    };
  }, [tasks]);

  const visible = useMemo(() => {
    const q = tr(search.trim());
    const rows = (tasks || []).filter(t => {
      if (assigneeFilter && !t.assignees?.some(a => a.staff.id === assigneeFilter)) return false;
      if (priorityFilter && t.priority !== priorityFilter) return false;
      if (overdueOnly && !isOverdue(t)) return false;
      if (!q) return true;
      return [t.title, t.description, t.location?.name, t.location?.company?.name]
        .some(f => typeof f === 'string' && tr(f).includes(q));
    });

    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'dueDate':
          // Bitiş tarihi olmayanlar sona; geciken görevler doğal olarak başa gelir.
          if (!a.dueDate && !b.dueDate) return 0;
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        case 'priority':
          return (PRIORITY_WEIGHT[b.priority] ?? 0) - (PRIORITY_WEIGHT[a.priority] ?? 0);
        case 'createdAt':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'title':
          return String(a.title).localeCompare(String(b.title), 'tr', { sensitivity: 'base' });
      }
    });
  }, [tasks, search, assigneeFilter, priorityFilter, overdueOnly, sortKey]);

  const filtersActive = !!(search || assigneeFilter || priorityFilter || overdueOnly || statusFilter);
  const clearFilters = () => {
    setSearch(''); setAssigneeFilter(''); setPriorityFilter('');
    setOverdueOnly(false); setStatusFilter('');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">Görevler</h1>
        {isManager && (
          <button
            onClick={() => { setShowForm(true); setEditId(null); setForm(emptyForm); }}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Yeni Görev
          </button>
        )}
      </div>

      {/* Stats — tıklanabilir filtre kısayolları */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <button
          onClick={clearFilters}
          className={`card p-3 text-left transition-shadow hover:shadow-md ${!filtersActive ? 'ring-2 ring-primary-500' : ''}`}
        >
          <div className="text-xs text-gray-500">Toplam</div>
          <div className="text-2xl font-bold">{stats.total}</div>
        </button>
        {([
          ['open', 'Açık', stats.open, 'text-blue-600'],
          ['in_progress', 'Devam', stats.inProgress, 'text-yellow-600'],
          ['done', 'Tamamlanan', stats.done, 'text-green-600'],
        ] as const).map(([key, label, value, color]) => (
          <button
            key={key}
            onClick={() => { setOverdueOnly(false); setStatusFilter(statusFilter === key ? '' : key); }}
            className={`card p-3 text-left transition-shadow hover:shadow-md ${statusFilter === key ? 'ring-2 ring-primary-500' : ''}`}
          >
            <div className="text-xs text-gray-500">{label}</div>
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
          </button>
        ))}
        <button
          onClick={() => { setStatusFilter(''); setOverdueOnly(v => !v); }}
          className={`card p-3 text-left transition-shadow hover:shadow-md ${overdueOnly ? 'ring-2 ring-red-500' : ''}`}
        >
          <div className="text-xs text-gray-500">Süresi Geçen</div>
          <div className="text-2xl font-bold text-red-600">{stats.overdue}</div>
        </button>
      </div>

      {/* Filters */}
      <div className="card p-3 flex flex-wrap gap-2 items-center">
        <label className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input-field !pl-8 w-full"
            placeholder="Başlık, açıklama veya lokasyon ara..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </label>

        {isManager && (
          <select
            className="input-field w-auto"
            value={scope}
              onChange={e => setScope(e.target.value as TaskScope)}
          >
            <option value="all">Tüm Görevler</option>
            <option value="assigned">Bana Atananlar</option>
            <option value="created">Oluşturduklarım</option>
          </select>
        )}

        {/* Yöneticinin en çok ihtiyaç duyduğu filtre: "Ali'nin görevleri". */}
        {isManager && scope === 'all' && (
          <select
            className="input-field w-auto"
            value={assigneeFilter}
            onChange={e => setAssigneeFilter(e.target.value)}
          >
            <option value="">Tüm personel</option>
                {(staffList || []).filter(s => s.isActive).map(s => (
              <option key={s.id} value={s.id}>{s.fullName}</option>
            ))}
          </select>
        )}

        <select className="input-field w-auto" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">Tüm Durumlar</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        <select className="input-field w-auto" value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
          <option value="">Tüm Öncelikler</option>
          {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        <select className="input-field w-auto" value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)}>
          {Object.entries(SORT_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        {filtersActive && (
          <button onClick={clearFilters} className="text-sm text-muted hover:text-primary-600 inline-flex items-center gap-1">
            <X className="w-3.5 h-3.5" /> Temizle
          </button>
        )}
        <span className="text-sm text-muted ml-auto">{visible.length} görev</span>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          {/* .card zaten dark: karşılığını içerir — ham bg-white karanlık modda beyaz kalıyordu. */}
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold mb-4">{editId ? 'Görevi Düzenle' : 'Yeni Görev'}</h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Başlık *</label>
                <input className="input-field" value={form.title} onChange={e => update({ title: e.target.value })} required maxLength={300} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Açıklama *</label>
                <textarea className="input-field" rows={4} value={form.description} onChange={e => update({ description: e.target.value })} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Öncelik</label>
                  <select className="input-field" value={form.priority} onChange={e => update({ priority: e.target.value })}>
                    {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Bitiş Tarihi</label>
                  <input type="datetime-local" className="input-field" value={form.dueDate} onChange={e => update({ dueDate: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Şirket {!editId && '*'}</label>
                  <select
                    className="input-field"
                    value={form.companyId}
                    onChange={e => update({ companyId: e.target.value, locationId: '' })}
                    required={!editId}
                  >
                    <option value="">Şirket seçin</option>
                    {companies?.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Lokasyon {!editId && '*'}</label>
                  <select
                    className="input-field"
                    value={form.locationId}
                    onChange={e => update({ locationId: e.target.value })}
                    required={!editId}
                    disabled={!form.companyId}
                  >
                    <option value="">{form.companyId ? 'Lokasyon seçin' : 'Önce şirket seçin'}</option>
                    {locations?.map(l => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Atanan Personeller * ({form.assigneeIds.length} seçili)</label>
                <div className="border rounded-lg max-h-60 overflow-y-auto p-2 space-y-1">
                  {staffList?.filter(s => s.isActive).map(s => (
                    <label key={s.id} className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${form.assigneeIds.includes(s.id) ? 'bg-primary-50 border border-primary-300' : 'hover:bg-gray-50 dark:hover:bg-slate-800/50'}`}>
                      <input
                        type="checkbox"
                        checked={form.assigneeIds.includes(s.id)}
                        onChange={() => toggleAssignee(s.id)}
                        className="rounded text-primary-600"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{s.fullName}</div>
                        <div className="text-xs text-gray-500">{s.email} · {s.role}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="btn-primary flex-1">Kaydet</button>
                <button type="button" onClick={() => { setShowForm(false); setEditId(null); }} className="btn-secondary flex-1">İptal</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-500">Yükleniyor...</div>
      ) : !visible.length ? (
        <div className="card p-12 text-center text-gray-500">
          {tasks?.length ? (
            <>
              <p>Filtrelerle eşleşen görev yok.</p>
              <button onClick={clearFilters} className="btn-secondary text-sm mt-3">Filtreleri temizle</button>
            </>
          ) : (
            'Görev bulunamadı'
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(t => {
            const days = daysOpen(t.createdAt, t.completedAt);
            const overdue = isOverdue(t);
            return (
              <div key={t.id} className={`card p-4 hover:shadow-md transition-shadow ${overdue ? 'border-l-4 border-l-red-500' : ''}`}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Link to={`/staff/tasks/${t.id}`} className="text-base font-semibold hover:text-primary-600">{t.title}</Link>
                      {/* Durum rozeti yok — sağdaki seçici hem durumu gösterir hem değiştirir. */}
                      <span className={`px-2 py-0.5 rounded-full text-xs ${PRIORITY_COLOR[t.priority]}`}>{PRIORITY_LABEL[t.priority]}</span>
                      {overdue && <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300 flex items-center gap-1"><AlertCircle className="w-3 h-3" />Süresi Geçti</span>}
                    </div>
                    <p className="text-sm text-gray-600 dark:text-slate-400 line-clamp-2">{t.description}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 flex-wrap">
                      <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{days} gündür açık</span>
                      <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{t.assignees.length} atanan</span>
                      {t.dueDate && <span>Bitiş: {new Date(t.dueDate).toLocaleDateString('tr-TR')}</span>}
                      <span>Oluşturan: {t.createdBy.fullName}</span>
                      {t.location && <span>Lokasyon: {t.location.company?.name} — {t.location.name}</span>}
                      {(t._count?.comments ?? 0) > 0 && <span>{t._count?.comments} yorum</span>}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {t.assignees.map(a => (
                        <span
                          key={a.staff.id}
                          className={`text-xs px-2 py-0.5 rounded-full cursor-default ${
                            assigneeFilter === a.staff.id
                              ? 'bg-primary-100 text-primary-800 dark:bg-primary-500/20 dark:text-primary-300'
                              : 'bg-gray-100 text-gray-700 dark:bg-slate-700/60 dark:text-slate-300'
                          }`}
                        >
                          {a.staff.fullName}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {/*
                      Durum listeden doğrudan değiştirilebilir. Önceden yalnızca
                      tek yönlü bir "Tamamlandı" butonu vardı: in_progress veya
                      cancelled'a geçilemiyor, yanlışlıkla tamamlanan görev geri
                      alınamıyordu (butonun kendisi kayboluyordu).
                    */}
                    <select
                      value={t.status}
                      onChange={(e) => handleStatus(t.id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`${t.title} durumu`}
                      className={`text-xs rounded-full border-0 px-2 py-1 cursor-pointer focus:ring-2 focus:ring-primary-500 ${STATUS_COLOR[t.status]}`}
                    >
                      {Object.entries(STATUS_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                    {isManager && (
                      <>
                        <button onClick={() => handleEdit(t)} className="p-1.5 hover:bg-gray-100 rounded" title="Düzenle">
                          <Edit2 className="w-4 h-4 text-gray-500" />
                        </button>
                        <button onClick={() => handleDelete(t.id)} className="p-1.5 hover:bg-red-100 rounded" title="Sil">
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
