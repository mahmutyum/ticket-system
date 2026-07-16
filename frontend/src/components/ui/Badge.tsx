import { PRIORITY_COLORS, PRIORITY_LABELS, STATUS_COLORS, STATUS_LABELS } from '../../types';

export function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300'}`}>{STATUS_LABELS[status] || status}</span>;
}

export function PriorityBadge({ priority }: { priority: string }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${PRIORITY_COLORS[priority] || 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300'}`}>{PRIORITY_LABELS[priority] || priority}</span>;
}
