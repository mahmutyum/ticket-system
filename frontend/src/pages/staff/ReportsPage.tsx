import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Download, BarChart3, Clock, CheckCircle2, Users, Tag,
  LayoutDashboard, TrendingUp, Filter, X,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  LineChart, Line,
} from 'recharts';
import api from '../../api/client';

type Period = 'daily' | 'weekly' | 'monthly';
type SlaPeriod = 'weekly' | 'monthly';
type TabKey = 'overview' | 'staff' | 'category' | 'sla';

interface Filters {
  dateFrom: string;
  dateTo: string;
  companyId: string;
  categoryId: string;
  assignedToId: string;
  priority: string;
}

const PRIORITIES = [
  { value: '', label: 'Tüm Öncelikler' },
  { value: 'low', label: 'Düşük' },
  { value: 'medium', label: 'Orta' },
  { value: 'high', label: 'Yüksek' },
  { value: 'critical', label: 'Kritik' },
];

function toInputDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = x.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  x.setDate(x.getDate() + offset);
  return x;
}

function presets() {
  const today = new Date();
  const monday = startOfWeek(today);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const last30 = new Date(today);
  last30.setDate(last30.getDate() - 29);
  const yearStart = new Date(today.getFullYear(), 0, 1);
  return [
    { key: 'thisWeek', label: 'Bu Hafta', from: toInputDate(monday), to: toInputDate(sunday) },
    { key: 'thisMonth', label: 'Bu Ay', from: toInputDate(monthStart), to: toInputDate(monthEnd) },
    { key: 'last30', label: 'Son 30 Gün', from: toInputDate(last30), to: toInputDate(today) },
    { key: 'thisYear', label: 'Bu Yıl', from: toInputDate(yearStart), to: toInputDate(today) },
  ];
}

function buildQS(filters: Filters, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  Object.entries({ ...filters, ...extra }).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  return params.toString();
}

export default function ReportsPage() {
  const [filters, setFilters] = useState<Filters>({
    dateFrom: '', dateTo: '', companyId: '', categoryId: '', assignedToId: '', priority: '',
  });
  const [tab, setTab] = useState<TabKey>('overview');
  const [period, setPeriod] = useState<Period>('daily');
  const [slaPeriod, setSlaPeriod] = useState<SlaPeriod>('weekly');

  const setFilter = (k: keyof Filters, v: string) => setFilters((prev) => ({ ...prev, [k]: v }));
  const applyPreset = (p: { from: string; to: string }) =>
    setFilters((prev) => ({ ...prev, dateFrom: p.from, dateTo: p.to }));
  const clearFilters = () =>
    setFilters({ dateFrom: '', dateTo: '', companyId: '', categoryId: '', assignedToId: '', priority: '' });

  const baseQS = useMemo(() => buildQS(filters), [filters]);
  const activeFilterCount = useMemo(
    () => Object.values(filters).filter(Boolean).length,
    [filters],
  );

  // Dropdown verileri
  const { data: companies } = useQuery({
    queryKey: ['companies-list'],
    queryFn: async () => (await api.get('/companies')).data.data as any[],
  });
  const { data: categories } = useQuery({
    queryKey: ['categories-list'],
    queryFn: async () => (await api.get('/categories')).data.data as any[],
  });
  const { data: staffList } = useQuery({
    queryKey: ['staff-list'],
    queryFn: async () => (await api.get('/staff')).data.data as any[],
  });

  // Genel istatistikler
  const { data: stats } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => (await api.get('/dashboard/stats')).data.data,
  });
  const { data: sla } = useQuery({
    queryKey: ['sla-report'],
    queryFn: async () => (await api.get('/dashboard/sla')).data.data,
  });

  // Overview zaman serisi
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['reports-overview', baseQS, period],
    queryFn: async () =>
      (await api.get(`/reports/overview?${buildQS(filters, { period })}`)).data.data as any[],
    enabled: tab === 'overview',
  });

  // Staff performance
  const { data: staffPerf } = useQuery({
    queryKey: ['staff-performance', baseQS],
    queryFn: async () => (await api.get(`/reports/staff-performance?${baseQS}`)).data.data as any[],
    enabled: tab === 'staff',
  });

  // Category breakdown
  const { data: categoryBreakdown } = useQuery({
    queryKey: ['category-breakdown', baseQS],
    queryFn: async () => (await api.get(`/reports/categories?${baseQS}`)).data.data as any[],
    enabled: tab === 'category',
  });

  // SLA trend
  const { data: slaTrend, isLoading: slaTrendLoading } = useQuery({
    queryKey: ['reports-sla-trends', baseQS, slaPeriod],
    queryFn: async () =>
      (await api.get(`/reports/sla-trends?${buildQS(filters, { period: slaPeriod })}`)).data.data as any[],
    enabled: tab === 'sla',
  });

  const handleExport = () => {
    window.open(`/api/reports/export/csv?${baseQS}`, '_blank');
  };

  const summary = useMemo(() => {
    if (!overview) return { created: 0, resolved: 0, inProgress: 0, overdue: 0 };
    return overview.reduce(
      (acc, b) => ({
        created: acc.created + b.created,
        resolved: acc.resolved + b.resolved,
        inProgress: acc.inProgress + b.inProgress,
        overdue: acc.overdue + b.overdue,
      }),
      { created: 0, resolved: 0, inProgress: 0, overdue: 0 },
    );
  }, [overview]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">Raporlar & İstatistikler</h1>
        <button onClick={handleExport} className="btn-primary flex items-center gap-2">
          <Download className="w-4 h-4" /> CSV İndir
        </button>
      </div>

      {/* Filtre paneli */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <Filter className="w-4 h-4" /> Filtreler
            {activeFilterCount > 0 && (
              <span className="text-xs bg-primary-100 text-primary-700 dark:bg-primary-500/20 dark:text-primary-200 px-2 py-0.5 rounded-full">
                {activeFilterCount} aktif
              </span>
            )}
          </h3>
          {activeFilterCount > 0 && (
            <button onClick={clearFilters} className="text-sm text-muted hover:text-primary-600 flex items-center gap-1">
              <X className="w-3 h-3" /> Temizle
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {presets().map((p) => {
            const active = filters.dateFrom === p.from && filters.dateTo === p.to;
            return (
              <button
                key={p.key}
                onClick={() => applyPreset(p)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  active
                    ? 'bg-primary-600 text-white border-primary-600'
                    : 'border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1 text-muted">Başlangıç</label>
            <input
              type="date"
              className="input-field !py-1.5 text-sm"
              value={filters.dateFrom}
              onChange={(e) => setFilter('dateFrom', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-muted">Bitiş</label>
            <input
              type="date"
              className="input-field !py-1.5 text-sm"
              value={filters.dateTo}
              onChange={(e) => setFilter('dateTo', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-muted">Şirket</label>
            <select
              className="input-field !py-1.5 text-sm"
              value={filters.companyId}
              onChange={(e) => setFilter('companyId', e.target.value)}
            >
              <option value="">Tüm Şirketler</option>
              {companies?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-muted">Kategori</label>
            <select
              className="input-field !py-1.5 text-sm"
              value={filters.categoryId}
              onChange={(e) => setFilter('categoryId', e.target.value)}
            >
              <option value="">Tüm Kategoriler</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-muted">Personel</label>
            <select
              className="input-field !py-1.5 text-sm"
              value={filters.assignedToId}
              onChange={(e) => setFilter('assignedToId', e.target.value)}
            >
              <option value="">Tüm Personel</option>
              {staffList?.map((s) => (
                <option key={s.id} value={s.id}>{s.fullName}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-muted">Öncelik</label>
            <select
              className="input-field !py-1.5 text-sm"
              value={filters.priority}
              onChange={(e) => setFilter('priority', e.target.value)}
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Sekmeler */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-slate-800 overflow-x-auto">
        {[
          { key: 'overview', label: 'Genel Bakış', Icon: LayoutDashboard },
          { key: 'staff', label: 'Personel', Icon: Users },
          { key: 'category', label: 'Kategori & Şirket', Icon: Tag },
          { key: 'sla', label: 'SLA Trend', Icon: TrendingUp },
        ].map(({ key, label, Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => setTab(key as TabKey)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                active
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-muted hover:text-primary-600'
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          );
        })}
      </div>

      {/* TAB: Genel Bakış */}
      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard label="Oluşturulan" value={summary.created} color="text-primary-600" />
            <SummaryCard label="Çözülen" value={summary.resolved} color="text-green-600" />
            <SummaryCard label="Devam Eden" value={summary.inProgress} color="text-yellow-600" />
            <SummaryCard label="SLA İhlali" value={summary.overdue} color="text-red-600" />
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-semibold">Talep Zaman Serisi</h3>
              <div className="flex gap-1">
                {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                      period === p
                        ? 'bg-primary-600 text-white border-primary-600'
                        : 'border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {p === 'daily' ? 'Günlük' : p === 'weekly' ? 'Haftalık' : 'Aylık'}
                  </button>
                ))}
              </div>
            </div>
            <div className="w-full" style={{ height: 320 }}>
              {overviewLoading ? (
                <div className="h-full flex items-center justify-center text-sm text-muted">Yükleniyor...</div>
              ) : !overview || overview.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted">Veri yok</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={overview} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="created" name="Oluşturulan" fill="#3b82f6" />
                    <Bar dataKey="resolved" name="Çözülen" fill="#10b981" />
                    <Bar dataKey="overdue" name="SLA İhlali" fill="#ef4444" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {sla && (
            <div className="grid md:grid-cols-3 gap-4">
              <div className="card text-center">
                <BarChart3 className="w-8 h-8 text-primary-500 mx-auto mb-2" />
                <p className="text-3xl font-bold">{sla.totalWithSla}</p>
                <p className="text-sm text-muted">SLA Tanımlı Talep</p>
              </div>
              <div className="card text-center">
                <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
                <p className="text-3xl font-bold text-green-600">{sla.response.complianceRate}%</p>
                <p className="text-sm text-muted">Yanıt SLA Uyumu</p>
                <p className="text-xs text-muted mt-1">{sla.response.met} başarılı / {sla.response.violated} ihlal</p>
              </div>
              <div className="card text-center">
                <Clock className="w-8 h-8 text-blue-500 mx-auto mb-2" />
                <p className="text-3xl font-bold text-blue-600">{sla.resolution.complianceRate}%</p>
                <p className="text-sm text-muted">Çözüm SLA Uyumu</p>
                <p className="text-xs text-muted mt-1">{sla.resolution.met} başarılı / {sla.resolution.violated} ihlal</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB: Personel */}
      {tab === 'staff' && (
        <div className="card">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Users className="w-5 h-5" /> Personel Performansı
          </h3>
          {!staffPerf || staffPerf.length === 0 ? (
            <p className="text-sm text-muted">Veri yok</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted border-b border-gray-200 dark:border-slate-800">
                    <th className="pb-2 font-medium">Personel</th>
                    <th className="pb-2 font-medium text-center">Toplam</th>
                    <th className="pb-2 font-medium text-center">Çözülen</th>
                    <th className="pb-2 font-medium text-center">Açık</th>
                    <th className="pb-2 font-medium text-center">Yanıt SLA</th>
                    <th className="pb-2 font-medium text-center">Çözüm SLA</th>
                    <th className="pb-2 font-medium text-center">Ort. Çözüm (saat)</th>
                  </tr>
                </thead>
                <tbody>
                  {staffPerf.map((s) => (
                    <tr key={s.id} className="border-b last:border-0 border-gray-100 dark:border-slate-800">
                      <td className="py-2 font-medium">{s.fullName}</td>
                      <td className="py-2 text-center">{s.totalAssigned}</td>
                      <td className="py-2 text-center text-green-600">{s.resolved}</td>
                      <td className="py-2 text-center text-orange-600">{s.open}</td>
                      <td className="py-2 text-center">
                        {s.slaResponseRate !== null ? (
                          <span className={s.slaResponseRate >= 80 ? 'text-green-600' : 'text-red-600'}>
                            {s.slaResponseRate}%
                          </span>
                        ) : '-'}
                      </td>
                      <td className="py-2 text-center">
                        {s.slaResolveRate !== null ? (
                          <span className={s.slaResolveRate >= 80 ? 'text-green-600' : 'text-red-600'}>
                            {s.slaResolveRate}%
                          </span>
                        ) : '-'}
                      </td>
                      <td className="py-2 text-center">
                        {s.avgResolutionHours !== null ? `${s.avgResolutionHours}h` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB: Kategori & Şirket */}
      {tab === 'category' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="card">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Tag className="w-5 h-5" /> Kategoriye Göre Dağılım
            </h3>
            {!categoryBreakdown || categoryBreakdown.length === 0 ? (
              <p className="text-sm text-muted">Veri yok</p>
            ) : (
              <div className="space-y-2">
                {categoryBreakdown.map((item) => {
                  const total = categoryBreakdown.reduce((s: number, i: any) => s + i.count, 0);
                  const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
                  return (
                    <div key={item.categoryId} className="flex items-center gap-3">
                      <span className="text-sm w-48 truncate">{item.categoryName}</span>
                      <div className="flex-1 bg-gray-100 dark:bg-slate-800 rounded-full h-3">
                        <div className="bg-primary-500 h-3 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-sm font-bold w-12 text-right">{item.count}</span>
                      <span className="text-xs text-muted w-10 text-right">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card">
            <h3 className="font-semibold mb-4">Şirkete Göre</h3>
            {!stats?.byCompany || stats.byCompany.length === 0 ? (
              <p className="text-sm text-muted">Veri yok</p>
            ) : (
              <div className="space-y-2">
                {stats.byCompany.map((item: any) => (
                  <div key={item.companyId} className="flex items-center justify-between py-1">
                    <span className="text-sm">{item.companyName}</span>
                    <span className="text-sm font-bold">{item.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {stats?.byStatus && (
            <div className="card lg:col-span-2">
              <h3 className="font-semibold mb-4">Duruma Göre</h3>
              <div className="space-y-2">
                {stats.byStatus.map((item: any) => {
                  const total = stats.byStatus.reduce((s: number, i: any) => s + i.count, 0);
                  const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
                  return (
                    <div key={item.status} className="flex items-center gap-3">
                      <span className="text-sm w-40 truncate">{item.status}</span>
                      <div className="flex-1 bg-gray-100 dark:bg-slate-800 rounded-full h-3">
                        <div className="bg-primary-500 h-3 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-sm font-bold w-12 text-right">{item.count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB: SLA Trend */}
      {tab === 'sla' && (
        <div className="space-y-4">
          <div className="card">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-semibold flex items-center gap-2">
                <TrendingUp className="w-5 h-5" /> SLA Uyum Trendi
              </h3>
              <div className="flex gap-1">
                {(['weekly', 'monthly'] as SlaPeriod[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setSlaPeriod(p)}
                    className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                      slaPeriod === p
                        ? 'bg-primary-600 text-white border-primary-600'
                        : 'border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {p === 'weekly' ? 'Haftalık' : 'Aylık'}
                  </button>
                ))}
              </div>
            </div>
            <div className="w-full" style={{ height: 320 }}>
              {slaTrendLoading ? (
                <div className="h-full flex items-center justify-center text-sm text-muted">Yükleniyor...</div>
              ) : !slaTrend || slaTrend.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted">Veri yok</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={slaTrend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="responseRate" name="Yanıt SLA %" stroke="#10b981" strokeWidth={2} />
                    <Line type="monotone" dataKey="resolveRate" name="Çözüm SLA %" stroke="#3b82f6" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {sla && (
            <div className="grid md:grid-cols-3 gap-4">
              <div className="card text-center">
                <BarChart3 className="w-8 h-8 text-primary-500 mx-auto mb-2" />
                <p className="text-3xl font-bold">{sla.totalWithSla}</p>
                <p className="text-sm text-muted">SLA Tanımlı Talep</p>
              </div>
              <div className="card text-center">
                <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
                <p className="text-3xl font-bold text-green-600">{sla.response.complianceRate}%</p>
                <p className="text-sm text-muted">Yanıt SLA Uyumu</p>
              </div>
              <div className="card text-center">
                <Clock className="w-8 h-8 text-blue-500 mx-auto mb-2" />
                <p className="text-3xl font-bold text-blue-600">{sla.resolution.complianceRate}%</p>
                <p className="text-sm text-muted">Çözüm SLA Uyumu</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="card text-center">
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      <p className="text-sm text-muted mt-1">{label}</p>
    </div>
  );
}
