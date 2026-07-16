import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PRIORITY_COLORS } from '../../../types';
import type { Staff } from '../../../types';
import { useEnumLabels } from '../../../i18n/labels';
import {
  TASK_SORT_KEYS, TASK_STATUS_KEYS,
  type TaskScope, type TaskSortKey,
} from './task-ui';

const PRIORITY_KEYS = Object.keys(PRIORITY_COLORS);

interface Props {
  isManager: boolean;
  scope: TaskScope;
  onScopeChange: (value: TaskScope) => void;
  search: string;
  onSearchChange: (value: string) => void;
  assigneeId: string;
  onAssigneeChange: (value: string) => void;
  status: string;
  onStatusChange: (value: string) => void;
  priority: string;
  onPriorityChange: (value: string) => void;
  sort: TaskSortKey;
  onSortChange: (value: TaskSortKey) => void;
  staff?: Staff[];
  active: boolean;
  onClear: () => void;
  resultCount: number;
}

export default function TaskFilters(props: Props) {
  const { t } = useTranslation();
  const labels = useEnumLabels();
  return (
    <div className="card p-3 flex flex-wrap gap-2 items-center">
      <label className="relative flex-1 min-w-[200px] max-w-xs">
        <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
        <input className="input-field !pl-8 w-full" placeholder={t('tasks.searchPlaceholder')} value={props.search} onChange={e => props.onSearchChange(e.target.value)} />
      </label>

      {props.isManager && <select className="input-field w-auto" value={props.scope} onChange={e => props.onScopeChange(e.target.value as TaskScope)}><option value="all">{t('tasks.scopeAll')}</option><option value="assigned">{t('tasks.scopeAssigned')}</option><option value="created">{t('tasks.scopeCreated')}</option></select>}

      {props.isManager && props.scope === 'all' && <select className="input-field w-auto" value={props.assigneeId} onChange={e => props.onAssigneeChange(e.target.value)}><option value="">{t('tasks.allStaff')}</option>{(props.staff || []).filter(item => item.isActive).map(item => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select>}

      <select className="input-field w-auto" value={props.status} onChange={e => props.onStatusChange(e.target.value)}><option value="">{t('tasks.allStatuses')}</option>{TASK_STATUS_KEYS.map(key => <option key={key} value={key}>{labels.taskStatus(key)}</option>)}</select>
      <select className="input-field w-auto" value={props.priority} onChange={e => props.onPriorityChange(e.target.value)}><option value="">{t('tasks.allPriorities')}</option>{PRIORITY_KEYS.map(key => <option key={key} value={key}>{labels.priority(key)}</option>)}</select>
      <select className="input-field w-auto" value={props.sort} onChange={e => props.onSortChange(e.target.value as TaskSortKey)}>{TASK_SORT_KEYS.map(key => <option key={key} value={key}>{t(`tasks.sort.${key}`)}</option>)}</select>

      {props.active && <button onClick={props.onClear} className="text-sm text-muted hover:text-primary-600 inline-flex items-center gap-1"><X className="w-3.5 h-3.5" /> {t('common.clear')}</button>}
      <span className="text-sm text-muted ml-auto">{t('tasks.taskCount', { count: props.resultCount })}</span>
    </div>
  );
}
