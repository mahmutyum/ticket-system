import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dateLocale } from '../../i18n/format';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertCircle, Clock, TrendingUp, User, Filter, X,
} from 'lucide-react';
import api from '../../api/client';
import { VALID_STATUSES, type DashboardStats } from '../../types';
import { useEnumLabels } from '../../i18n/labels';
import { useStaffSSE } from '../../hooks/useSSE';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, SkeletonRows } from '../../components/ui/AsyncState';
import { PriorityBadge, StatusBadge } from '../../components/ui/Badge';

export default function DashboardPage() {
  const { t } = useTranslation();
  const labels = useEnumLabels();
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  useStaffSSE({
    onTicketCreated: () => queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] }),
    onTicketUpdated: () => queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] }),
  });

  const filterParams = new URLSearchParams();
  if (companyId) filterParams.set('companyId', companyId);
  if (status) filterParams.set('status', status);
  if (onlyMine) filterParams.set('onlyMine', 'true');

  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats', companyId, status, onlyMine],
    queryFn: async () => (await api.get(`/dashboard/stats?${filterParams}`)).data.data,
  });

  const hasFilters = companyId || status || onlyMine;

  const clearFilters = () => {
    setCompanyId('');
    setStatus('');
    setOnlyMine(false);
  };

  if (isLoading || !stats) {
    return <div className="card overflow-hidden p-0"><SkeletonRows rows={6} /></div>;
  }

  const summaryCards = [
    { label: t('dashboard.cards.openLabel'), hint: t('dashboard.cards.openHint'), value: stats.summary.totalOpen, icon: AlertCircle, color: 'text-blue-700 bg-blue-100 dark:bg-blue-500/15 dark:text-blue-300' },
    { label: t('dashboard.cards.inProgressLabel'), hint: t('dashboard.cards.inProgressHint'), value: stats.summary.totalInProgress, icon: Clock, color: 'text-amber-700 bg-amber-100 dark:bg-amber-500/15 dark:text-amber-300' },
    { label: t('dashboard.cards.todayLabel'), hint: t('dashboard.cards.todayHint'), value: stats.summary.todayCreated, icon: TrendingUp, color: 'text-emerald-700 bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300' },
    { label: t('dashboard.cards.slaLabel'), hint: t('dashboard.cards.slaHint'), value: stats.summary.slaViolations, icon: AlertCircle, color: 'text-red-700 bg-red-100 dark:bg-red-500/15 dark:text-red-300' },
    { label: t('dashboard.cards.mineLabel'), hint: t('dashboard.cards.mineHint'), value: stats.summary.myOpen, icon: User, color: 'text-violet-700 bg-violet-100 dark:bg-violet-500/15 dark:text-violet-300' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('dashboard.eyebrow')}
        title={t('dashboard.title')}
        description={t('dashboard.description')}
        actions={
          <>
          {hasFilters && (
            <button onClick={clearFilters} className="btn-secondary text-xs flex items-center gap-1">
              <X className="w-3 h-3" /> {t('common.clearFilters')}
            </button>
          )}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`btn-secondary text-sm flex items-center gap-2 ${hasFilters ? 'ring-2 ring-primary-300' : ''}`}
          >
            <Filter className="w-4 h-4" /> {t('common.filter')}
          </button>
          </>
        }
      />

      {/* Filter panel */}
      {showFilters && (
        <div className="card surface-2 shadow-none">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="min-w-[180px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('common.company')}</label>
              <select className="input-field text-sm" value={companyId} onChange={e => setCompanyId(e.target.value)}>
                <option value="">{t('dashboard.allCompanies')}</option>
                {stats.accessibleCompanies.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="min-w-[180px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('common.status')}</label>
              <select className="input-field text-sm" value={status} onChange={e => setStatus(e.target.value)}>
                <option value="">{t('dashboard.allStatuses')}</option>
                {VALID_STATUSES.map(s => (
                  <option key={s} value={s}>{labels.status(s)}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer pb-2">
              <input type="checkbox" checked={onlyMine} onChange={e => setOnlyMine(e.target.checked)} className="rounded text-primary-600" />
              {t('dashboard.onlyMine')}
            </label>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {summaryCards.map(card => (
          <div key={card.label} className="card flex items-center gap-4 overflow-hidden relative">
            <div className={`p-3 rounded-2xl ${card.color}`}>
              <card.icon className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold tracking-tight">{card.value}</p>
              <p className="text-sm font-semibold">{card.label}</p>
              <p className="truncate text-xs text-muted">{card.hint}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Status distribution */}
        <div className="card">
          <h3 className="font-semibold mb-4">{t('dashboard.byStatus')}</h3>
          <div className="space-y-2">
            {stats.byStatus.map(item => {
              const total = stats.byStatus.reduce((s, i) => s + i.count, 0);
              const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
              return (
                <button
                  key={item.status}
                  onClick={() => { setStatus(item.status); setShowFilters(true); }}
                  className="flex items-center gap-3 w-full hover:bg-gray-50 dark:hover:bg-slate-800/50 rounded-lg px-2 py-1 -mx-2 transition-colors"
                >
                  <StatusBadge status={item.status} />
                  <div className="flex-1 bg-gray-100 rounded-full h-2">
                    <div className="bg-primary-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-sm font-medium w-10 text-right">{item.count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* By company */}
        <div className="card">
          <h3 className="font-semibold mb-4">{t('dashboard.byCompany')}</h3>
          <div className="space-y-3">
            {stats.byCompany.map(item => (
              <button
                key={item.companyId}
                onClick={() => { setCompanyId(item.companyId); setShowFilters(true); }}
                className="flex items-center justify-between w-full hover:bg-gray-50 dark:hover:bg-slate-800/50 rounded-lg px-2 py-1 -mx-2 transition-colors"
              >
                <span className="text-sm">{item.companyName}</span>
                <span className="text-sm font-bold">{item.count}</span>
              </button>
            ))}
            {stats.byCompany.length === 0 && (
              <p className="text-sm text-gray-400">{t('common.noData')}</p>
            )}
          </div>
        </div>
      </div>

      {/* Recent tickets */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">{t('dashboard.recentTickets')}</h3>
          <Link to="/staff/tickets" className="text-sm text-primary-600 hover:underline">
            {t('dashboard.viewAll')}
          </Link>
        </div>
        {stats.recentTickets.length === 0 ? (
          <EmptyState title={t('dashboard.emptyTitle')} description={t('dashboard.emptyDesc')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 font-medium">{t('dashboard.colNo')}</th>
                  <th className="pb-2 font-medium">{t('common.subject')}</th>
                  <th className="pb-2 font-medium">{t('common.company')}</th>
                  <th className="pb-2 font-medium">{t('common.status')}</th>
                  <th className="pb-2 font-medium">{t('common.priority')}</th>
                  <th className="pb-2 font-medium">{t('common.assignedTo')}</th>
                  <th className="pb-2 font-medium">{t('common.date')}</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentTickets.map(ticket => (
                  <tr key={ticket.id} className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-slate-800/50">
                    <td className="py-2">
                      <Link to={`/staff/tickets/${ticket.id}`} className="text-primary-600 hover:underline font-mono text-xs">
                        {ticket.ticketNumber}
                      </Link>
                    </td>
                    <td className="py-2 max-w-[200px] truncate">{ticket.subject}</td>
                    <td className="py-2 text-gray-500">{ticket.company.name}</td>
                    <td className="py-2">
                      <StatusBadge status={ticket.status} />
                    </td>
                    <td className="py-2"><PriorityBadge priority={ticket.priority} /></td>
                    <td className="py-2 text-gray-500">{ticket.assignedTo?.fullName || '-'}</td>
                    <td className="py-2 text-gray-400 text-xs">
                      {new Date(ticket.createdAt).toLocaleDateString(dateLocale())}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
