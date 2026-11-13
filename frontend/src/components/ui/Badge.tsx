import { PauseCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PRIORITY_COLORS, STATUS_COLORS } from '../../types';
import { useEnumLabels } from '../../i18n/labels';

/**
 * DB color tokenı → tailwind sınıf haritası (v1.3). Sözlükteki `color` kolonu
 * token adıdır (blue/green/red/…) — panelden eklenen yeni durumlar da buradan
 * renk alır; bilinmeyen token griye düşer.
 */
const TOKEN_COLORS: Record<string, string> = {
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
  green: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
  gray: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
  yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300',
  indigo: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300',
};

const FALLBACK = 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300';

const classesFor = (dbToken: string, localMap: Record<string, string>, key: string): string =>
  TOKEN_COLORS[dbToken] ?? localMap[key] ?? FALLBACK;

export function StatusBadge({ status, slaPaused = false }: { status: string; slaPaused?: boolean }) {
  const labels = useEnumLabels();
  const { t } = useTranslation();
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${classesFor(labels.statusColor(status), STATUS_COLORS, status)}`}>
      {slaPaused && <PauseCircle className="h-3.5 w-3.5" aria-label={t('common.slaPaused')}><title>{t('common.slaPaused')}</title></PauseCircle>}
      {labels.status(status)}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  const labels = useEnumLabels();
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${classesFor(labels.priorityColor(priority), PRIORITY_COLORS, priority)}`}>{labels.priority(priority)}</span>;
}
