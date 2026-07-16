import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ArrowLeft, Send, Clock, User, Users, AlertCircle, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { getApiError } from '../../utils/api-error';
import { useAuthStore } from '../../stores/auth.store';
// Öncelik sözlüğü ticket'larla ORTAK — burada kopyalama, tek kaynaktan al.
import { PRIORITY_LABELS as PRIORITY_LABEL, PRIORITY_COLORS as PRIORITY_COLOR } from '../../types';
import type { Task } from '../../types';

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

function daysOpen(createdAt: string, completedAt?: string | null): number {
  const start = new Date(createdAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  return Math.max(0, Math.floor((end - start) / (1000 * 60 * 60 * 24)));
}

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);

  const { data: task, isLoading } = useQuery<Task>({
    queryKey: ['task', id],
    queryFn: async () => (await api.get(`/tasks/${id}`)).data.data,
    enabled: !!id,
  });

  const handleStatus = async (status: string) => {
    try {
      await api.patch(`/tasks/${id}/status`, { status });
      queryClient.invalidateQueries({ queryKey: ['task', id] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast.success('Durum güncellendi');
    } catch (err: unknown) {
      toast.error(getApiError(err, 'Güncelleme başarısız'));
    }
  };

  const handleComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) return;
    setSending(true);
    try {
      await api.post(`/tasks/${id}/comments`, { content: comment });
      setComment('');
      queryClient.invalidateQueries({ queryKey: ['task', id] });
      toast.success('Yorum eklendi');
    } catch (err: unknown) {
      toast.error(getApiError(err, 'Yorum eklenemedi'));
    } finally {
      setSending(false);
    }
  };

  if (isLoading) return <div className="text-center py-12 text-gray-500">Yükleniyor...</div>;
  if (!task) return <div className="text-center py-12 text-gray-500">Görev bulunamadı</div>;

  const days = daysOpen(task.createdAt, task.completedAt);
  const overdue = task.dueDate && task.status !== 'done' && task.status !== 'cancelled' && new Date(task.dueDate) < new Date();
  const isManager = user?.role === 'admin' || user?.role === 'it_manager';
  const isAssignee = task.assignees.some(a => a.staff.id === user?.id);

  return (
    <div className="space-y-4 max-w-4xl">
      <Link to="/staff/tasks" className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-slate-400 hover:text-primary-600">
        <ArrowLeft className="w-4 h-4" /> Görev Listesi
      </Link>

      <div className="card p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
          <div>
            <h1 className="text-2xl font-bold mb-2">{task.title}</h1>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`px-2.5 py-1 rounded-full text-xs ${STATUS_COLOR[task.status]}`}>{STATUS_LABEL[task.status]}</span>
              <span className={`px-2.5 py-1 rounded-full text-xs ${PRIORITY_COLOR[task.priority]}`}>{PRIORITY_LABEL[task.priority]}</span>
              {overdue && <span className="px-2.5 py-1 rounded-full text-xs bg-red-100 text-red-700 flex items-center gap-1"><AlertCircle className="w-3 h-3" />Süresi Geçti</span>}
            </div>
          </div>
          {(isManager || isAssignee) && (
            <select
              className="input-field max-w-[180px]"
              value={task.status}
              onChange={e => handleStatus(e.target.value)}
            >
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}
        </div>

        <div className="prose max-w-none text-sm whitespace-pre-wrap text-gray-700 dark:text-slate-300 mb-4 bg-gray-50 dark:bg-slate-800/50 p-3 rounded-lg">
          {task.description}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm border-t pt-4">
          <div>
            <div className="text-xs text-gray-500 flex items-center gap-1"><Clock className="w-3.5 h-3.5" />Açık Gün</div>
            <div className="font-semibold">{days} gün</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Oluşturulma</div>
            <div className="font-medium">{new Date(task.createdAt).toLocaleString('tr-TR')}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Bitiş Tarihi</div>
            <div className="font-medium">{task.dueDate ? new Date(task.dueDate).toLocaleString('tr-TR') : '—'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Tamamlanma</div>
            <div className="font-medium">{task.completedAt ? new Date(task.completedAt).toLocaleString('tr-TR') : '—'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Lokasyon</div>
            <div className="font-medium">{task.location ? `${task.location.company?.name} — ${task.location.name}` : '—'}</div>
          </div>
        </div>

        <div className="border-t mt-4 pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-gray-500 flex items-center gap-1 mb-2"><User className="w-3.5 h-3.5" />Oluşturan</div>
            <div className="text-sm">{task.createdBy.fullName} <span className="text-gray-500">({task.createdBy.email})</span></div>
          </div>
          <div>
            <div className="text-xs text-gray-500 flex items-center gap-1 mb-2"><Users className="w-3.5 h-3.5" />Atanan Personeller ({task.assignees.length})</div>
            <div className="flex flex-wrap gap-1">
              {task.assignees.map(a => (
                <span key={a.staff.id} className="text-xs bg-primary-50 text-primary-700 px-2 py-1 rounded-full">
                  {a.staff.fullName}
                </span>
              ))}
            </div>
          </div>
        </div>

        {task.status !== 'done' && task.status !== 'cancelled' && (isManager || isAssignee) && (
          <div className="border-t mt-4 pt-4 flex gap-2">
            {task.status === 'open' && (
              <button onClick={() => handleStatus('in_progress')} className="btn-secondary flex items-center gap-2 text-sm">
                <Clock className="w-4 h-4" /> Devam Ediyor
              </button>
            )}
            <button onClick={() => handleStatus('done')} className="btn-primary flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4" /> Tamamlandı
            </button>
          </div>
        )}
      </div>

      {/* Comments */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-4">Yorumlar ({task.comments?.length || 0})</h2>

        <div className="space-y-3 mb-4">
          {task.comments?.length ? task.comments.map(c => (
            <div key={c.id} className="border-l-2 border-primary-300 pl-3 py-1">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span className="font-medium text-gray-700 dark:text-slate-300">{c.createdBy.fullName}</span>
                <span>{new Date(c.createdAt).toLocaleString('tr-TR')}</span>
              </div>
              <div className="text-sm whitespace-pre-wrap">{c.content}</div>
            </div>
          )) : (
            <div className="text-sm text-gray-400 text-center py-4">Henüz yorum yok</div>
          )}
        </div>

        <form onSubmit={handleComment} className="flex gap-2 border-t pt-4">
          <input
            className="input-field flex-1"
            placeholder="Yorum yazın..."
            value={comment}
            onChange={e => setComment(e.target.value)}
            disabled={sending}
          />
          <button type="submit" disabled={sending || !comment.trim()} className="btn-primary flex items-center gap-2">
            <Send className="w-4 h-4" /> Gönder
          </button>
        </form>
      </div>
    </div>
  );
}
