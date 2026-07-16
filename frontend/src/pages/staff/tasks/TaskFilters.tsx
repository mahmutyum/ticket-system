import { Search, X } from 'lucide-react';
import { PRIORITY_LABELS } from '../../../types';
import type { Staff } from '../../../types';
import {
  TASK_SORT_LABELS, TASK_STATUS_LABELS,
  type TaskScope, type TaskSortKey,
} from './task-ui';

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
  return (
    <div className="card p-3 flex flex-wrap gap-2 items-center">
      <label className="relative flex-1 min-w-[200px] max-w-xs">
        <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
        <input className="input-field !pl-8 w-full" placeholder="Başlık, açıklama veya lokasyon ara..." value={props.search} onChange={e => props.onSearchChange(e.target.value)} />
      </label>

      {props.isManager && <select className="input-field w-auto" value={props.scope} onChange={e => props.onScopeChange(e.target.value as TaskScope)}><option value="all">Tüm Görevler</option><option value="assigned">Bana Atananlar</option><option value="created">Oluşturduklarım</option></select>}

      {props.isManager && props.scope === 'all' && <select className="input-field w-auto" value={props.assigneeId} onChange={e => props.onAssigneeChange(e.target.value)}><option value="">Tüm personel</option>{(props.staff || []).filter(item => item.isActive).map(item => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select>}

      <select className="input-field w-auto" value={props.status} onChange={e => props.onStatusChange(e.target.value)}><option value="">Tüm Durumlar</option>{Object.entries(TASK_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <select className="input-field w-auto" value={props.priority} onChange={e => props.onPriorityChange(e.target.value)}><option value="">Tüm Öncelikler</option>{Object.entries(PRIORITY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <select className="input-field w-auto" value={props.sort} onChange={e => props.onSortChange(e.target.value as TaskSortKey)}>{Object.entries(TASK_SORT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>

      {props.active && <button onClick={props.onClear} className="text-sm text-muted hover:text-primary-600 inline-flex items-center gap-1"><X className="w-3.5 h-3.5" /> Temizle</button>}
      <span className="text-sm text-muted ml-auto">{props.resultCount} görev</span>
    </div>
  );
}
