import { Filter, X } from 'lucide-react';
import type { Category, Company, Staff } from '../../../types';
import { EMPTY_REPORT_FILTERS, type ReportFilters } from './report-types';

const PRIORITIES = [
  { value: '', label: 'Tüm Öncelikler' },
  { value: 'low', label: 'Düşük' },
  { value: 'medium', label: 'Orta' },
  { value: 'high', label: 'Yüksek' },
  { value: 'critical', label: 'Kritik' },
];

function toInputDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfWeek(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  const day = result.getDay();
  result.setDate(result.getDate() + (day === 0 ? -6 : 1 - day));
  return result;
}

function datePresets() {
  const today = new Date();
  const monday = startOfWeek(today);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const last30 = new Date(today);
  last30.setDate(last30.getDate() - 29);
  return [
    { key: 'thisWeek', label: 'Bu Hafta', from: toInputDate(monday), to: toInputDate(sunday) },
    { key: 'thisMonth', label: 'Bu Ay', from: toInputDate(monthStart), to: toInputDate(monthEnd) },
    { key: 'last30', label: 'Son 30 Gün', from: toInputDate(last30), to: toInputDate(today) },
    { key: 'thisYear', label: 'Bu Yıl', from: `${today.getFullYear()}-01-01`, to: toInputDate(today) },
  ];
}

interface Props {
  filters: ReportFilters;
  onChange: (filters: ReportFilters) => void;
  companies?: Company[];
  categories?: Category[];
  staff?: Staff[];
}

export default function ReportFiltersPanel({ filters, onChange, companies, categories, staff }: Props) {
  const activeCount = Object.values(filters).filter(Boolean).length;
  const setFilter = (key: keyof ReportFilters, value: string) => onChange({ ...filters, [key]: value });

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Filter className="w-4 h-4" /> Filtreler
          {activeCount > 0 && <span className="text-xs bg-primary-100 text-primary-700 dark:bg-primary-500/20 dark:text-primary-200 px-2 py-0.5 rounded-full">{activeCount} aktif</span>}
        </h3>
        {activeCount > 0 && <button onClick={() => onChange(EMPTY_REPORT_FILTERS)} className="text-sm text-muted hover:text-primary-600 flex items-center gap-1"><X className="w-3 h-3" /> Temizle</button>}
      </div>

      <div className="flex flex-wrap gap-2">
        {datePresets().map(preset => {
          const active = filters.dateFrom === preset.from && filters.dateTo === preset.to;
          return <button key={preset.key} onClick={() => onChange({ ...filters, dateFrom: preset.from, dateTo: preset.to })} className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${active ? 'bg-primary-600 text-white border-primary-600' : 'border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800'}`}>{preset.label}</button>;
        })}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div><label className="block text-xs font-medium mb-1 text-muted">Başlangıç</label><input type="date" className="input-field !py-1.5 text-sm" value={filters.dateFrom} onChange={e => setFilter('dateFrom', e.target.value)} /></div>
        <div><label className="block text-xs font-medium mb-1 text-muted">Bitiş</label><input type="date" className="input-field !py-1.5 text-sm" value={filters.dateTo} onChange={e => setFilter('dateTo', e.target.value)} /></div>
        <div><label className="block text-xs font-medium mb-1 text-muted">Şirket</label><select className="input-field !py-1.5 text-sm" value={filters.companyId} onChange={e => setFilter('companyId', e.target.value)}><option value="">Tüm Şirketler</option>{companies?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div><label className="block text-xs font-medium mb-1 text-muted">Kategori</label><select className="input-field !py-1.5 text-sm" value={filters.categoryId} onChange={e => setFilter('categoryId', e.target.value)}><option value="">Tüm Kategoriler</option>{categories?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div><label className="block text-xs font-medium mb-1 text-muted">Personel</label><select className="input-field !py-1.5 text-sm" value={filters.assignedToId} onChange={e => setFilter('assignedToId', e.target.value)}><option value="">Tüm Personel</option>{staff?.map(item => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></div>
        <div><label className="block text-xs font-medium mb-1 text-muted">Öncelik</label><select className="input-field !py-1.5 text-sm" value={filters.priority} onChange={e => setFilter('priority', e.target.value)}>{PRIORITIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
      </div>
    </div>
  );
}
