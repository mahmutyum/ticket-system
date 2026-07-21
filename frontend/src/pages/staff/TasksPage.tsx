import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { dateLocale } from '../../i18n/format';
import { Link } from 'react-router-dom';
import { Plus, Edit2, Trash2, Users, Clock, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { useAuthStore } from '../../stores/auth.store';
// Öncelik sözlüğü ticket'larla ORTAK — burada kopyalama, tek kaynaktan al.
import { PRIORITY_COLORS as PRIORITY_COLOR, PRIORITY_WEIGHT } from '../../types';
import type { Company, Location, Staff, Task } from '../../types';
import { useEnumLabels } from '../../i18n/labels';
import { getApiError } from '../../utils/api-error';
import TaskFilters from './tasks/TaskFilters';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, SkeletonRows } from '../../components/ui/AsyncState';
import {
  EMPTY_TASK_FORM, TASK_STATUS_COLORS, TASK_STATUS_KEYS, isTaskOverdue, taskDaysOpen,
  type TaskFormState, type TaskPayload, type TaskScope, type TaskSortKey,
} from './tasks/task-ui';

const PRIORITY_KEYS = Object.keys(PRIORITY_COLOR);

/** Türkçe'ye duyarlı arama — 'İ/ı' İngilizce toLowerCase ile bozulur. */
const tr = (s: string) => s.toLocaleLowerCase('tr');


export default function TasksPage() {
  const { t } = useTranslation();
  const labels = useEnumLabels();
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
  const [sortKey, setSortKey] = useState<TaskSortKey>('dueDate');

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<TaskFormState>(EMPTY_TASK_FORM);

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

  const update = (fields: Partial<TaskFormState>) => setForm(prev => ({ ...prev, ...fields }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.assigneeIds.length === 0) {
      toast.error(t('tasks.errAssigneeRequired'));
      return;
    }
    if (!editId && !form.locationId) {
      toast.error(t('tasks.errLocationRequired'));
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
        toast.success(t('tasks.updated'));
      } else {
        await api.post('/tasks', payload);
        toast.success(t('tasks.createdWithNotify'));
      }
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setShowForm(false);
      setEditId(null);
      setForm(EMPTY_TASK_FORM);
    } catch (err: unknown) {
      toast.error(getApiError(err, t('common.operationFailed')));
    }
  };

  const handleEdit = (task: Task) => {
    setEditId(task.id);
    setForm({
      title: task.title,
      description: task.description,
      priority: task.priority,
      dueDate: task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 16) : '',
      assigneeIds: task.assignees.map(a => a.staff.id),
      companyId: task.location?.company?.id || '',
      locationId: task.location?.id || '',
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('tasks.confirmDelete'))) return;
    try {
      await api.delete(`/tasks/${id}`);
      toast.success(t('tasks.deleted'));
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    } catch {
      toast.error(t('tasks.deleteFailed'));
    }
  };

  const handleStatus = async (id: string, status: string) => {
    try {
      await api.patch(`/tasks/${id}/status`, { status });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast.success(t('tasks.statusUpdated'));
    } catch {
      toast.error(t('tasks.updateFailed'));
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
      overdue: list.filter(isTaskOverdue).length,
    };
  }, [tasks]);

  const visible = useMemo(() => {
    const q = tr(search.trim());
    const rows = (tasks || []).filter(t => {
      if (assigneeFilter && !t.assignees?.some(a => a.staff.id === assigneeFilter)) return false;
      if (priorityFilter && t.priority !== priorityFilter) return false;
      if (overdueOnly && !isTaskOverdue(t)) return false;
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
      <PageHeader eyebrow={t('tasks.eyebrow')} title={t('tasks.title')} description={t('tasks.description')} actions={isManager ? (
          <button
            onClick={() => { setShowForm(true); setEditId(null); setForm(EMPTY_TASK_FORM); }}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> {t('tasks.newTask')}
          </button>
        ) : undefined} />

      {/* Stats — tıklanabilir filtre kısayolları */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <button
          onClick={clearFilters}
          className={`card p-3 text-left transition-shadow hover:shadow-raised ${!filtersActive ? 'ring-2 ring-primary-500' : ''}`}
        >
          <div className="text-xs text-gray-500">{t('common.total')}</div>
          <div className="text-2xl font-bold">{stats.total}</div>
        </button>
        {([
          ['open', t('tasks.statOpen'), stats.open, 'text-blue-600'],
          ['in_progress', t('tasks.statInProgress'), stats.inProgress, 'text-yellow-600'],
          ['done', t('tasks.statDone'), stats.done, 'text-green-600'],
        ] as const).map(([key, label, value, color]) => (
          <button
            key={key}
            onClick={() => { setOverdueOnly(false); setStatusFilter(statusFilter === key ? '' : key); }}
            className={`card p-3 text-left transition-shadow hover:shadow-raised ${statusFilter === key ? 'ring-2 ring-primary-500' : ''}`}
          >
            <div className="text-xs text-gray-500">{label}</div>
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
          </button>
        ))}
        <button
          onClick={() => { setStatusFilter(''); setOverdueOnly(v => !v); }}
          className={`card p-3 text-left transition-shadow hover:shadow-raised ${overdueOnly ? 'ring-2 ring-red-500' : ''}`}
        >
          <div className="text-xs text-gray-500">{t('tasks.overdue')}</div>
          <div className="text-2xl font-bold text-red-600">{stats.overdue}</div>
        </button>
      </div>

      <TaskFilters
        isManager={isManager}
        scope={scope}
        onScopeChange={setScope}
        search={search}
        onSearchChange={setSearch}
        assigneeId={assigneeFilter}
        onAssigneeChange={setAssigneeFilter}
        status={statusFilter}
        onStatusChange={setStatusFilter}
        priority={priorityFilter}
        onPriorityChange={setPriorityFilter}
        sort={sortKey}
        onSortChange={setSortKey}
        staff={staffList}
        active={filtersActive}
        onClear={clearFilters}
        resultCount={visible.length}
      />

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          {/* .card zaten dark: karşılığını içerir — ham bg-white karanlık modda beyaz kalıyordu. */}
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="dialog-title mb-4">{editId ? t('tasks.editTask') : t('tasks.newTask')}</h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t('tasks.fieldTitle')} *</label>
                <input className="input-field" value={form.title} onChange={e => update({ title: e.target.value })} required maxLength={300} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('common.description')} *</label>
                <textarea className="input-field" rows={4} value={form.description} onChange={e => update({ description: e.target.value })} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">{t('common.priority')}</label>
                  <select className="input-field" value={form.priority} onChange={e => update({ priority: e.target.value })}>
                    {PRIORITY_KEYS.map(k => <option key={k} value={k}>{labels.priority(k)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('tasks.dueDate')}</label>
                  <input type="datetime-local" className="input-field" value={form.dueDate} onChange={e => update({ dueDate: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">{t('common.company')} {!editId && '*'}</label>
                  <select
                    className="input-field"
                    value={form.companyId}
                    onChange={e => update({ companyId: e.target.value, locationId: '' })}
                    required={!editId}
                  >
                    <option value="">{t('tasks.selectCompany')}</option>
                    {companies?.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('common.location')} {!editId && '*'}</label>
                  <select
                    className="input-field"
                    value={form.locationId}
                    onChange={e => update({ locationId: e.target.value })}
                    required={!editId}
                    disabled={!form.companyId}
                  >
                    <option value="">{form.companyId ? t('tasks.selectLocation') : t('tasks.selectCompanyFirst')}</option>
                    {locations?.map(l => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('tasks.assigneesLabel', { count: form.assigneeIds.length })}</label>
                <div className="border rounded-inset max-h-60 overflow-y-auto p-2 space-y-1">
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
                        <div className="text-xs text-gray-500">{s.email} · {labels.role(s.role)}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="btn-primary flex-1">{t('common.save')}</button>
                <button type="button" onClick={() => { setShowForm(false); setEditId(null); }} className="btn-secondary flex-1">{t('common.cancel')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="card overflow-hidden p-0"><SkeletonRows rows={6} /></div>
      ) : !visible.length ? (
        <div className="card">
          {tasks?.length ? (
            <div className="text-center"><EmptyState title={t('tasks.noMatchTitle')} description={t('tasks.noMatchDesc')} /><button onClick={clearFilters} className="btn-secondary text-sm -mt-8 mb-6">{t('common.clearFilters')}</button></div>
          ) : (
            <EmptyState title={t('tasks.emptyTitle')} description={t('tasks.emptyDesc')} />
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(task => {
            const days = taskDaysOpen(task.createdAt, task.completedAt);
            const overdue = isTaskOverdue(task);
            return (
              <div key={task.id} className={`card p-4 hover:shadow-raised transition-shadow ${overdue ? 'border-l-4 border-l-red-500' : ''}`}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Link to={`/staff/tasks/${task.id}`} className="text-base font-semibold hover:text-primary-600">{task.title}</Link>
                      {/* Durum rozeti yok — sağdaki seçici hem durumu gösterir hem değiştirir. */}
                      <span className={`px-2 py-0.5 rounded-full text-xs ${PRIORITY_COLOR[task.priority]}`}>{labels.priority(task.priority)}</span>
                      {overdue && <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{t('tasks.overdueBadge')}</span>}
                    </div>
                    <p className="text-sm text-gray-600 dark:text-slate-400 line-clamp-2">{task.description}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 flex-wrap">
                      <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{t('tasks.daysOpen', { count: days })}</span>
                      <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{t('tasks.assigneeCount', { count: task.assignees.length })}</span>
                      {task.dueDate && <span>{t('tasks.dueLabel', { date: new Date(task.dueDate).toLocaleDateString(dateLocale()) })}</span>}
                      <span>{t('tasks.createdByLabel', { name: task.createdBy.fullName })}</span>
                      {task.location && <span>{t('tasks.locationLabel', { company: task.location.company?.name, name: task.location.name })}</span>}
                      {(task._count?.comments ?? 0) > 0 && <span>{t('tasks.commentCount', { count: task._count?.comments })}</span>}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {task.assignees.map(a => (
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
                      value={task.status}
                      onChange={(e) => handleStatus(task.id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={t('tasks.statusAria', { title: task.title })}
                      className={`text-xs rounded-full border-0 px-2 py-1 cursor-pointer ${TASK_STATUS_COLORS[task.status]}`}
                    >
                      {TASK_STATUS_KEYS.map(k => (
                        <option key={k} value={k}>{labels.taskStatus(k)}</option>
                      ))}
                    </select>
                    {isManager && (
                      <>
                        <button onClick={() => handleEdit(task)} className="p-1.5 hover:bg-gray-100 rounded" title={t('common.edit')}>
                          <Edit2 className="w-4 h-4 text-gray-500" />
                        </button>
                        <button onClick={() => handleDelete(task.id)} className="p-1.5 hover:bg-red-100 rounded" title={t('common.delete')}>
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
