import { PauseCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PRIORITY_COLORS, STATUS_COLORS } from '../../types';
import { useEnumLabels } from '../../i18n/labels';

export function StatusBadge({ status, slaPaused = false }: { status: string; slaPaused?: boolean }) {
  const labels = useEnumLabels();
  const { t } = useTranslation();
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300'}`}>
      {slaPaused && <PauseCircle className="h-3.5 w-3.5" aria-label={t('common.slaPaused')}><title>{t('common.slaPaused')}</title></PauseCircle>}
      {labels.status(status)}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  const labels = useEnumLabels();
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${PRIORITY_COLORS[priority] || 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300'}`}>{labels.priority(priority)}</span>;
}
