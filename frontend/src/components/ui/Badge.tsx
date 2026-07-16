import { PRIORITY_COLORS, STATUS_COLORS } from '../../types';
import { useEnumLabels } from '../../i18n/labels';

export function StatusBadge({ status }: { status: string }) {
  const labels = useEnumLabels();
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300'}`}>{labels.status(status)}</span>;
}

export function PriorityBadge({ priority }: { priority: string }) {
  const labels = useEnumLabels();
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${PRIORITY_COLORS[priority] || 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300'}`}>{labels.priority(priority)}</span>;
}
