import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Download, BarChart3, Clock, CheckCircle2, Users, Tag,
  LayoutDashboard, TrendingUp,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  LineChart, Line,
} from 'recharts';
import api from '../../api/client';
import type { Category, Company, DashboardStats, Staff } from '../../types';
import ReportFiltersPanel from './reports/ReportFilters';
import { PageHeader } from '../../components/ui/PageHeader';
import {
  EMPTY_REPORT_FILTERS, buildReportQuery,
  type CategoryBreakdown, type OverviewBucket, type Period, type ReportFilters,
  type SlaPeriod, type SlaSummary, type SlaTrendBucket, type StaffPerformance, type TabKey,
} from './reports/report-types';

export default function ReportsPage() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<ReportFilters>(EMPTY_REPORT_FILTERS);
  const [tab, setTab] = useState<TabKey>('overview');
  const [period, setPeriod] = useState<Period>('daily');
  const [slaPeriod, setSlaPeriod] = useState<SlaPeriod>('weekly');

  const baseQS = useMemo(() => buildReportQuery(filters), [filters]);

  // Dropdown verileri
  const { data: companies } = useQuery<Company[]>({
    queryKey: ['companies-list'],
    queryFn: async () => (await api.get('/companies')).data.data,
  });
  const { data: categories } = useQuery<Category[]>({
    queryKey: ['categories-list'],
    queryFn: async () => (await api.get('/categories')).data.data,
  });
  const { data: staffList } = useQuery<Staff[]>({
    queryKey: ['staff-list'],
    queryFn: async () => (await api.get('/staff')).data.data,
  });

  // Genel istatistikler
  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: async () => (await api.get('/dashboard/stats')).data.data,
  });
  const { data: sla } = useQuery<SlaSummary>({
    queryKey: ['sla-report'],
    queryFn: async () => (await api.get('/dashboard/sla')).data.data,
  });

  // Overview zaman serisi
  const { data: overview, isLoading: overviewLoading } = useQuery<OverviewBucket[]>({
    queryKey: ['reports-overview', baseQS, period],
    queryFn: async () =>
      (await api.get(`/reports/overview?${buildReportQuery(filters, { period })}`)).data.data,
    enabled: tab === 'overview',
  });

  // Staff performance
  const { data: staffPerf } = useQuery<StaffPerformance[]>({
    queryKey: ['staff-performance', baseQS],
    queryFn: async () => (await api.get(`/reports/staff-performance?${baseQS}`)).data.data,
    enabled: tab === 'staff',
  });

  // Category breakdown
  const { data: categoryBreakdown } = useQuery<CategoryBreakdown[]>({
    queryKey: ['category-breakdown', baseQS],
    queryFn: async () => (await api.get(`/reports/categories?${baseQS}`)).data.data,
    enabled: tab === 'category',
  });

  // SLA trend
  const { data: slaTrend, isLoading: slaTrendLoading } = useQuery<SlaTrendBucket[]>({
    queryKey: ['reports-sla-trends', baseQS, slaPeriod],
    queryFn: async () =>
      (await api.get(`/reports/sla-trends?${buildReportQuery(filters, { period: slaPeriod })}`)).data.data,
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
      <PageHeader eyebrow={t('reports.eyebrow')} title={t('reports.title')} description={t('reports.description')} actions={
        <button onClick={handleExport} className="btn-primary flex items-center gap-2">
          <Download className="w-4 h-4" /> {t('reports.exportCsv')}
        </button>
      } />

      <ReportFiltersPanel
        filters={filters}
        onChange={setFilters}
        companies={companies}
        categories={categories}
        staff={staffList}
      />

      {/* Sekmeler */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-slate-800 overflow-x-auto">
        {[
          { key: 'overview', label: t('reports.tabs.overview'), Icon: LayoutDashboard },
          { key: 'staff', label: t('reports.tabs.staff'), Icon: Users },
          { key: 'category', label: t('reports.tabs.category'), Icon: Tag },
          { key: 'sla', label: t('reports.tabs.sla'), Icon: TrendingUp },
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
            <SummaryCard label={t('reports.created')} value={summary.created} color="text-primary-600" />
            <SummaryCard label={t('reports.resolved')} value={summary.resolved} color="text-green-600" />
            <SummaryCard label={t('reports.inProgress')} value={summary.inProgress} color="text-yellow-600" />
            <SummaryCard label={t('reports.overdue')} value={summary.overdue} color="text-red-600" />
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-semibold">{t('reports.timeSeriesTitle')}</h3>
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
                    {p === 'daily' ? t('reports.daily') : p === 'weekly' ? t('reports.weekly') : t('reports.monthly')}
                  </button>
                ))}
              </div>
            </div>
            <div className="w-full" style={{ height: 320 }}>
              {overviewLoading ? (
                <div className="h-full flex items-center justify-center text-sm text-muted">{t('common.loading')}</div>
              ) : !overview || overview.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted">{t('common.noData')}</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={overview} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="created" name={t('reports.created')} fill="#3b82f6" />
                    <Bar dataKey="resolved" name={t('reports.resolved')} fill="#10b981" />
                    <Bar dataKey="overdue" name={t('reports.overdue')} fill="#ef4444" />
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
                <p className="text-sm text-muted">{t('reports.slaTotal')}</p>
              </div>
              <div className="card text-center">
                <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
                <p className="text-3xl font-bold text-green-600">{sla.response.complianceRate}%</p>
                <p className="text-sm text-muted">{t('reports.responseCompliance')}</p>
                <p className="text-xs text-muted mt-1">{t('reports.metViolated', { met: sla.response.met, violated: sla.response.violated })}</p>
              </div>
              <div className="card text-center">
                <Clock className="w-8 h-8 text-blue-500 mx-auto mb-2" />
                <p className="text-3xl font-bold text-blue-600">{sla.resolution.complianceRate}%</p>
                <p className="text-sm text-muted">{t('reports.resolutionCompliance')}</p>
                <p className="text-xs text-muted mt-1">{t('reports.metViolated', { met: sla.resolution.met, violated: sla.resolution.violated })}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB: Personel */}
      {tab === 'staff' && (
        <div className="card">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Users className="w-5 h-5" /> {t('reports.staffPerformance')}
          </h3>
          {!staffPerf || staffPerf.length === 0 ? (
            <p className="text-sm text-muted">{t('common.noData')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr className="text-left text-muted border-b border-gray-200 dark:border-slate-800">
                    <th className="pb-2 font-medium">{t('reports.colStaff')}</th>
                    <th className="pb-2 font-medium text-center">{t('common.total')}</th>
                    <th className="pb-2 font-medium text-center">{t('reports.resolved')}</th>
                    <th className="pb-2 font-medium text-center">{t('reports.colOpen')}</th>
                    <th className="pb-2 font-medium text-center">{t('reports.colResponseSla')}</th>
                    <th className="pb-2 font-medium text-center">{t('reports.colResolveSla')}</th>
                    <th className="pb-2 font-medium text-center">{t('reports.colAvgResolution')}</th>
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
              <Tag className="w-5 h-5" /> {t('reports.byCategory')}
            </h3>
            {!categoryBreakdown || categoryBreakdown.length === 0 ? (
              <p className="text-sm text-muted">{t('common.noData')}</p>
            ) : (
              <div className="space-y-2">
                {categoryBreakdown.map((item) => {
                  const total = categoryBreakdown.reduce((sum, category) => sum + category.count, 0);
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
            <h3 className="font-semibold mb-4">{t('reports.byCompany')}</h3>
            {!stats?.byCompany || stats.byCompany.length === 0 ? (
              <p className="text-sm text-muted">{t('common.noData')}</p>
            ) : (
              <div className="space-y-2">
                {stats.byCompany.map(item => (
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
              <h3 className="font-semibold mb-4">{t('reports.byStatus')}</h3>
              <div className="space-y-2">
                {stats.byStatus.map(item => {
                  const total = stats.byStatus.reduce((sum, status) => sum + status.count, 0);
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
                <TrendingUp className="w-5 h-5" /> {t('reports.slaTrendTitle')}
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
                    {p === 'weekly' ? t('reports.weekly') : t('reports.monthly')}
                  </button>
                ))}
              </div>
            </div>
            <div className="w-full" style={{ height: 320 }}>
              {slaTrendLoading ? (
                <div className="h-full flex items-center justify-center text-sm text-muted">{t('common.loading')}</div>
              ) : !slaTrend || slaTrend.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted">{t('common.noData')}</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={slaTrend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="responseRate" name={t('reports.responseRateLabel')} stroke="#10b981" strokeWidth={2} />
                    <Line type="monotone" dataKey="resolveRate" name={t('reports.resolveRateLabel')} stroke="#3b82f6" strokeWidth={2} />
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
                <p className="text-sm text-muted">{t('reports.slaTotal')}</p>
              </div>
              <div className="card text-center">
                <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
                <p className="text-3xl font-bold text-green-600">{sla.response.complianceRate}%</p>
                <p className="text-sm text-muted">{t('reports.responseCompliance')}</p>
              </div>
              <div className="card text-center">
                <Clock className="w-8 h-8 text-blue-500 mx-auto mb-2" />
                <p className="text-3xl font-bold text-blue-600">{sla.resolution.complianceRate}%</p>
                <p className="text-sm text-muted">{t('reports.resolutionCompliance')}</p>
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
