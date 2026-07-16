import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertCircle, Clock, TrendingUp, User, Filter, X,
} from 'lucide-react';
import api from '../../api/client';
import { STATUS_LABELS, STATUS_COLORS, PRIORITY_LABELS, type DashboardStats } from '../../types';
import { useStaffSSE } from '../../hooks/useSSE';

export default function DashboardPage() {
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
    return <div className="text-center py-12 text-gray-400">Yükleniyor...</div>;
  }

  const summaryCards = [
    { label: 'Açık Talepler', value: stats.summary.totalOpen, icon: AlertCircle, color: 'text-blue-600 bg-blue-100' },
    { label: 'İşlemde', value: stats.summary.totalInProgress, icon: Clock, color: 'text-yellow-600 bg-yellow-100' },
    { label: 'Bugün Açılan', value: stats.summary.todayCreated, icon: TrendingUp, color: 'text-green-600 bg-green-100' },
    { label: 'SLA İhlali', value: stats.summary.slaViolations, icon: AlertCircle, color: 'text-red-600 bg-red-100' },
    { label: 'Bana Atanan', value: stats.summary.myOpen, icon: User, color: 'text-purple-600 bg-purple-100' },
  ];

  return (
    <div className="space-y-6">
      {/* Header with filters */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex items-center gap-2">
          {hasFilters && (
            <button onClick={clearFilters} className="btn-secondary text-xs flex items-center gap-1">
              <X className="w-3 h-3" /> Filtreleri Temizle
            </button>
          )}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`btn-secondary text-sm flex items-center gap-2 ${hasFilters ? 'ring-2 ring-primary-300' : ''}`}
          >
            <Filter className="w-4 h-4" /> Filtrele
          </button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="card bg-gray-50 dark:bg-slate-800/50">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="min-w-[180px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Şirket</label>
              <select className="input-field text-sm" value={companyId} onChange={e => setCompanyId(e.target.value)}>
                <option value="">Tüm Şirketler</option>
                {stats.accessibleCompanies.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="min-w-[180px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Durum</label>
              <select className="input-field text-sm" value={status} onChange={e => setStatus(e.target.value)}>
                <option value="">Tüm Durumlar</option>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer pb-2">
              <input type="checkbox" checked={onlyMine} onChange={e => setOnlyMine(e.target.checked)} className="rounded text-primary-600" />
              Sadece bana atananlar
            </label>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {summaryCards.map(card => (
          <div key={card.label} className="card flex items-center gap-4">
            <div className={`p-3 rounded-xl ${card.color}`}>
              <card.icon className="w-6 h-6" />
            </div>
            <div>
              <p className="text-2xl font-bold">{card.value}</p>
              <p className="text-sm text-gray-500">{card.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Status distribution */}
        <div className="card">
          <h3 className="font-semibold mb-4">Duruma Göre Dağılım</h3>
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
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium min-w-[80px] text-center ${STATUS_COLORS[item.status] || 'bg-gray-100'}`}>
                    {STATUS_LABELS[item.status] || item.status}
                  </span>
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
          <h3 className="font-semibold mb-4">Şirkete Göre Dağılım</h3>
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
              <p className="text-sm text-gray-400">Veri yok</p>
            )}
          </div>
        </div>
      </div>

      {/* Recent tickets */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Son Talepler</h3>
          <Link to="/staff/tickets" className="text-sm text-primary-600 hover:underline">
            Tümünü Gör
          </Link>
        </div>
        {stats.recentTickets.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">Filtre kriterlerine uygun talep yok</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 font-medium">No</th>
                  <th className="pb-2 font-medium">Konu</th>
                  <th className="pb-2 font-medium">Şirket</th>
                  <th className="pb-2 font-medium">Durum</th>
                  <th className="pb-2 font-medium">Öncelik</th>
                  <th className="pb-2 font-medium">Atanan</th>
                  <th className="pb-2 font-medium">Tarih</th>
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
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[ticket.status] || ''}`}>
                        {STATUS_LABELS[ticket.status] || ticket.status}
                      </span>
                    </td>
                    <td className="py-2 text-xs">{PRIORITY_LABELS[ticket.priority] || ticket.priority}</td>
                    <td className="py-2 text-gray-500">{ticket.assignedTo?.fullName || '-'}</td>
                    <td className="py-2 text-gray-400 text-xs">
                      {new Date(ticket.createdAt).toLocaleDateString('tr-TR')}
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
