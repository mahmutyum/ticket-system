import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertCircle, Clock, CheckCircle2, TrendingUp,
} from 'lucide-react';
import api from '../../api/client';
import { STATUS_LABELS, STATUS_COLORS, PRIORITY_LABELS } from '../../types';
import type { DashboardStats } from '../../types';
import { useStaffSSE } from '../../hooks/useSSE';

export default function DashboardPage() {
  const queryClient = useQueryClient();

  // SSE: auto-refresh on ticket events
  useStaffSSE({
    onTicketCreated: () => queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] }),
    onTicketUpdated: () => queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] }),
  });

  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: async () => (await api.get('/dashboard/stats')).data.data,
  });

  if (isLoading || !stats) {
    return <div className="text-center py-12 text-gray-400">Yükleniyor...</div>;
  }

  const summaryCards = [
    { label: 'Açık Talepler', value: stats.summary.totalOpen, icon: AlertCircle, color: 'text-blue-600 bg-blue-100' },
    { label: 'İşlemde', value: stats.summary.totalInProgress, icon: Clock, color: 'text-yellow-600 bg-yellow-100' },
    { label: 'Bugün Açılan', value: stats.summary.todayCreated, icon: TrendingUp, color: 'text-green-600 bg-green-100' },
    { label: 'SLA İhlali', value: stats.summary.slaViolations, icon: AlertCircle, color: 'text-red-600 bg-red-100' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
                <div key={item.status} className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[item.status] || 'bg-gray-100'}`}>
                    {STATUS_LABELS[item.status] || item.status}
                  </span>
                  <div className="flex-1 bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-primary-500 h-2 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium w-10 text-right">{item.count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* By company */}
        <div className="card">
          <h3 className="font-semibold mb-4">Şirkete Göre Dağılım</h3>
          <div className="space-y-3">
            {stats.byCompany.map(item => (
              <div key={item.companyId} className="flex items-center justify-between">
                <span className="text-sm">{item.companyName}</span>
                <span className="text-sm font-bold">{item.count}</span>
              </div>
            ))}
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
                <tr key={ticket.id} className="border-b last:border-0 hover:bg-gray-50">
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
      </div>
    </div>
  );
}
