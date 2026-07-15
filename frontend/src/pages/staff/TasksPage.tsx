import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Edit2, Trash2, Users, Clock, AlertCircle, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { useAuthStore } from '../../stores/auth.store';

const STATUS_LABEL: Record<string, string> = {
  open: 'Açık',
  in_progress: 'Devam Ediyor',
  done: 'Tamamlandı',
  cancelled: 'İptal',
};

const STATUS_COLOR: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-yellow-100 text-yellow-800',
  done: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-200 text-gray-600 dark:text-slate-400',
};

const PRIORITY_LABEL: Record<string, string> = {
  low: 'Düşük',
  medium: 'Orta',
  high: 'Yüksek',
  urgent: 'Acil',
};

const PRIORITY_COLOR: Record<string, string> = {
  low: 'bg-gray-100 text-gray-700 dark:text-slate-300',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
};

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

  const [scope, setScope] = useState<'all' | 'assigned' | 'created'>(isManager ? 'all' : 'assigned');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const { data: tasks, isLoading } = useQuery({
    queryKey: ['tasks', scope, statusFilter],
    queryFn: async () => {
      const params: any = {};
      if (scope !== 'all') params.scope = scope;
      if (statusFilter) params.status = statusFilter;
      const qs = new URLSearchParams(params).toString();
      return (await api.get(`/tasks${qs ? `?${qs}` : ''}`)).data.data;
    },
  });

  const { data: staffList } = useQuery({
    queryKey: ['staff-all'],
    queryFn: async () => (await api.get('/staff')).data.data,
    enabled: isManager,
  });

  const { data: companies } = useQuery({
    queryKey: ['companies-active'],
    queryFn: async () => (await api.get('/companies')).data.data,
    enabled: isManager,
  });

  const { data: locations } = useQuery({
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
      const payload: any = {
        title: form.title,
        description: form.description,
        priority: form.priority,
        assigneeIds: form.assigneeIds,
      };
      if (form.locationId) payload.locationId = form.locationId;
      if (form.dueDate) payload.dueDate = new Date(form.dueDate).toISOString();
      else payload.dueDate = null;

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
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'İşlem başarısız');
    }
  };

  const handleEdit = (t: any) => {
    setEditId(t.id);
    setForm({
      title: t.title,
      description: t.description,
      priority: t.priority,
      dueDate: t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 16) : '',
      assigneeIds: t.assignees.map((a: any) => a.staff.id),
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

  const stats = useMemo(() => {
    const list = tasks || [];
    return {
      total: list.length,
      open: list.filter((t: any) => t.status === 'open').length,
      inProgress: list.filter((t: any) => t.status === 'in_progress').length,
      done: list.filter((t: any) => t.status === 'done').length,
      overdue: list.filter((t: any) => t.dueDate && t.status !== 'done' && t.status !== 'cancelled' && new Date(t.dueDate) < new Date()).length,
    };
  }, [tasks]);

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

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="card p-3"><div className="text-xs text-gray-500">Toplam</div><div className="text-2xl font-bold">{stats.total}</div></div>
        <div className="card p-3"><div className="text-xs text-gray-500">Açık</div><div className="text-2xl font-bold text-blue-600">{stats.open}</div></div>
        <div className="card p-3"><div className="text-xs text-gray-500">Devam</div><div className="text-2xl font-bold text-yellow-600">{stats.inProgress}</div></div>
        <div className="card p-3"><div className="text-xs text-gray-500">Tamamlanan</div><div className="text-2xl font-bold text-green-600">{stats.done}</div></div>
        <div className="card p-3"><div className="text-xs text-gray-500">Süresi Geçen</div><div className="text-2xl font-bold text-red-600">{stats.overdue}</div></div>
      </div>

      {/* Filters */}
      <div className="card p-3 flex flex-wrap gap-3 items-center">
        {isManager && (
          <select
            className="input-field max-w-[200px]"
            value={scope}
            onChange={e => setScope(e.target.value as any)}
          >
            <option value="all">Tüm Görevler</option>
            <option value="assigned">Bana Atananlar</option>
            <option value="created">Oluşturduklarım</option>
          </select>
        )}
        <select
          className="input-field max-w-[200px]"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="">Tüm Durumlar</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
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
                    {companies?.map((c: any) => (
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
                    {locations?.map((l: any) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Atanan Personeller * ({form.assigneeIds.length} seçili)</label>
                <div className="border rounded-lg max-h-60 overflow-y-auto p-2 space-y-1">
                  {staffList?.filter((s: any) => s.isActive).map((s: any) => (
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
      ) : !tasks?.length ? (
        <div className="card p-12 text-center text-gray-500">Görev bulunamadı</div>
      ) : (
        <div className="space-y-2">
          {tasks.map((t: any) => {
            const days = daysOpen(t.createdAt, t.completedAt);
            const overdue = t.dueDate && t.status !== 'done' && t.status !== 'cancelled' && new Date(t.dueDate) < new Date();
            return (
              <div key={t.id} className="card p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Link to={`/staff/tasks/${t.id}`} className="text-base font-semibold hover:text-primary-600">{t.title}</Link>
                      <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLOR[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs ${PRIORITY_COLOR[t.priority]}`}>{PRIORITY_LABEL[t.priority]}</span>
                      {overdue && <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700 flex items-center gap-1"><AlertCircle className="w-3 h-3" />Süresi Geçti</span>}
                    </div>
                    <p className="text-sm text-gray-600 dark:text-slate-400 line-clamp-2">{t.description}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 flex-wrap">
                      <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{days} gündür açık</span>
                      <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{t.assignees.length} atanan</span>
                      {t.dueDate && <span>Bitiş: {new Date(t.dueDate).toLocaleDateString('tr-TR')}</span>}
                      <span>Oluşturan: {t.createdBy.fullName}</span>
                      {t.location && <span>Lokasyon: {t.location.company?.name} — {t.location.name}</span>}
                      {t._count?.comments > 0 && <span>{t._count.comments} yorum</span>}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {t.assignees.map((a: any) => (
                        <span key={a.staff.id} className="text-xs bg-gray-100 px-2 py-0.5 rounded-full">{a.staff.fullName}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {t.status !== 'done' && t.status !== 'cancelled' && (
                      <button onClick={() => handleStatus(t.id, 'done')} className="p-1.5 hover:bg-green-100 rounded text-green-600" title="Tamamlandı işaretle">
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                    )}
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
