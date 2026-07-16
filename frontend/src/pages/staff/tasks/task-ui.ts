import type { Task } from '../../../types';

export type TaskSortKey = 'dueDate' | 'priority' | 'createdAt' | 'title';
export type TaskScope = 'all' | 'assigned' | 'created';

export interface TaskFormState {
  title: string;
  description: string;
  priority: string;
  dueDate: string;
  assigneeIds: string[];
  companyId: string;
  locationId: string;
}

export interface TaskPayload {
  title: string;
  description: string;
  priority: string;
  assigneeIds: string[];
  locationId?: string;
  dueDate: string | null;
}

export const EMPTY_TASK_FORM: TaskFormState = {
  title: '', description: '', priority: 'medium', dueDate: '',
  assigneeIds: [], companyId: '', locationId: '',
};

export const TASK_STATUS_LABELS: Record<string, string> = {
  open: 'Açık',
  in_progress: 'Devam Ediyor',
  done: 'Tamamlandı',
  cancelled: 'İptal',
};

export const TASK_STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
  in_progress: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300',
  done: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
  cancelled: 'bg-gray-200 text-gray-600 dark:bg-slate-700/60 dark:text-slate-400',
};

export const TASK_SORT_LABELS: Record<TaskSortKey, string> = {
  dueDate: 'Bitiş tarihi (yakın önce)',
  priority: 'Öncelik (acil önce)',
  createdAt: 'Oluşturma (yeni önce)',
  title: 'Başlık (A-Z)',
};

export const isTaskOverdue = (task: Task) =>
  !!task.dueDate && task.status !== 'done' && task.status !== 'cancelled' && new Date(task.dueDate) < new Date();

export function taskDaysOpen(createdAt: string, completedAt?: string | null): number {
  const start = new Date(createdAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  return Math.max(0, Math.floor((end - start) / (1000 * 60 * 60 * 24)));
}
