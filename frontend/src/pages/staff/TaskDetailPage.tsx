import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dateLocale } from '../../i18n/format';
import { ArrowLeft, Send, Clock, User, Users, AlertCircle, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { getApiError } from '../../utils/api-error';
import { useAuthStore } from '../../stores/auth.store';
import { useEnumLabels } from '../../i18n/labels';
// Öncelik renkleri ticket'larla ORTAK — burada kopyalama, tek kaynaktan al.
import { PRIORITY_COLORS as PRIORITY_COLOR } from '../../types';
import type { Task } from '../../types';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, SkeletonRows } from '../../components/ui/AsyncState';

const TASK_STATUSES = ['open', 'in_progress', 'done', 'cancelled'] as const;

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
  const { t } = useTranslation();
  const labels = useEnumLabels();
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
      toast.success(t('taskDetail.statusUpdated'));
    } catch (err: unknown) {
      toast.error(getApiError(err, t('taskDetail.updateFailed')));
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
      toast.success(t('taskDetail.commentAdded'));
    } catch (err: unknown) {
      toast.error(getApiError(err, t('taskDetail.commentFailed')));
    } finally {
      setSending(false);
    }
  };

  if (isLoading) return <div className="card max-w-4xl overflow-hidden p-0"><SkeletonRows rows={6} /></div>;
  if (!task) return <div className="card max-w-4xl"><EmptyState title={t('taskDetail.notFoundTitle')} description={t('taskDetail.notFoundDescription')} /></div>;

  const days = daysOpen(task.createdAt, task.completedAt);
  const overdue = task.dueDate && task.status !== 'done' && task.status !== 'cancelled' && new Date(task.dueDate) < new Date();
  const isManager = user?.role === 'admin' || user?.role === 'it_manager';
  const isAssignee = task.assignees.some(a => a.staff.id === user?.id);

  return (
    <div className="space-y-4 max-w-4xl">
      <PageHeader eyebrow={t('taskDetail.eyebrow')} title={task.title} description={t('taskDetail.headerDescription', { company: task.location?.company?.name ?? t('taskDetail.companyGeneral'), days })} actions={<><Link to="/staff/tasks" className="icon-button" aria-label={t('taskDetail.backToList')}><ArrowLeft className="w-4 h-4" /></Link>{(isManager || isAssignee) && <select className="input-field max-w-[180px]" value={task.status} onChange={e => handleStatus(e.target.value)}>{TASK_STATUSES.map(k => <option key={k} value={k}>{labels.taskStatus(k)}</option>)}</select>}</>} />

      <div className="card p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`px-2.5 py-1 rounded-full text-xs ${STATUS_COLOR[task.status]}`}>{labels.taskStatus(task.status)}</span>
              <span className={`px-2.5 py-1 rounded-full text-xs ${PRIORITY_COLOR[task.priority]}`}>{labels.priority(task.priority)}</span>
              {overdue && <span className="px-2.5 py-1 rounded-full text-xs bg-red-100 text-red-700 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{t('taskDetail.overdue')}</span>}
            </div>
          </div>
        </div>

        <div className="prose max-w-none text-sm whitespace-pre-wrap text-gray-700 dark:text-slate-300 mb-4 bg-gray-50 dark:bg-slate-800/50 p-3 rounded-inset">
          {task.description}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm border-t pt-4">
          <div>
            <div className="text-xs text-gray-500 flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{t('taskDetail.daysOpenLabel')}</div>
            <div className="font-semibold">{t('taskDetail.daysValue', { days })}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">{t('common.createdAt')}</div>
            <div className="font-medium">{new Date(task.createdAt).toLocaleString(dateLocale())}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">{t('taskDetail.dueDate')}</div>
            <div className="font-medium">{task.dueDate ? new Date(task.dueDate).toLocaleString(dateLocale()) : '—'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">{t('taskDetail.completedAt')}</div>
            <div className="font-medium">{task.completedAt ? new Date(task.completedAt).toLocaleString(dateLocale()) : '—'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">{t('common.location')}</div>
            <div className="font-medium">{task.location ? `${task.location.company?.name} — ${task.location.name}` : '—'}</div>
          </div>
        </div>

        <div className="border-t mt-4 pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-gray-500 flex items-center gap-1 mb-2"><User className="w-3.5 h-3.5" />{t('taskDetail.createdBy')}</div>
            <div className="text-sm">{task.createdBy.fullName} <span className="text-gray-500">({task.createdBy.email})</span></div>
          </div>
          <div>
            <div className="text-xs text-gray-500 flex items-center gap-1 mb-2"><Users className="w-3.5 h-3.5" />{t('taskDetail.assignees', { count: task.assignees.length })}</div>
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
                <Clock className="w-4 h-4" /> {t('taskDetail.markInProgress')}
              </button>
            )}
            <button onClick={() => handleStatus('done')} className="btn-primary flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4" /> {t('taskDetail.markDone')}
            </button>
          </div>
        )}
      </div>

      {/* Comments */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-4">{t('taskDetail.commentsHeading', { count: task.comments?.length || 0 })}</h2>

        <div className="space-y-3 mb-4">
          {task.comments?.length ? task.comments.map(c => (
            <div key={c.id} className="border-l-2 border-primary-300 pl-3 py-1">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span className="font-medium text-gray-700 dark:text-slate-300">{c.createdBy.fullName}</span>
                <span>{new Date(c.createdAt).toLocaleString(dateLocale())}</span>
              </div>
              <div className="text-sm whitespace-pre-wrap">{c.content}</div>
            </div>
          )) : (
            <div className="text-sm text-gray-400 text-center py-4">{t('taskDetail.noComments')}</div>
          )}
        </div>

        <form onSubmit={handleComment} className="flex gap-2 border-t pt-4">
          <input
            className="input-field flex-1"
            placeholder={t('taskDetail.commentPlaceholder')}
            value={comment}
            onChange={e => setComment(e.target.value)}
            disabled={sending}
          />
          <button type="submit" disabled={sending || !comment.trim()} className="btn-primary flex items-center gap-2">
            <Send className="w-4 h-4" /> {t('taskDetail.send')}
          </button>
        </form>
      </div>
    </div>
  );
}
