import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../../api/client';
import { STATUS_LABELS, STATUS_COLORS, PRIORITY_LABELS, PRIORITY_COLORS } from '../../types';
import type { Ticket, PaginatedResponse } from '../../types';
import { useStaffSSE } from '../../hooks/useSSE';

export default function TicketListPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');

  // SSE: auto-refresh on ticket events
  useStaffSSE({
    onTicketCreated: () => queryClient.invalidateQueries({ queryKey: ['tickets'] }),
    onTicketUpdated: () => queryClient.invalidateQueries({ queryKey: ['tickets'] }),
  });

  const { data, isLoading } = useQuery<PaginatedResponse<Ticket>>({
    queryKey: ['tickets', page, search, statusFilter, priorityFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '20');
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      if (priorityFilter) params.set('priority', priorityFilter);
      return (await api.get(`/tickets?${params}`)).data;
    },
  });

  const tickets = data?.data || [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Talepler</h1>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                className="input-field pl-10"
                placeholder="Ara... (konu, numara, email)"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
          </div>
          <select
            className="input-field w-auto"
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          >
            <option value="">Tüm Durumlar</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            className="input-field w-auto"
            value={priorityFilter}
            onChange={e => { setPriorityFilter(e.target.value); setPage(1); }}
          >
            <option value="">Tüm Öncelikler</option>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        {isLoading ? (
          <div className="text-center py-12 text-gray-400">Yükleniyor...</div>
        ) : tickets.length === 0 ? (
          <div className="text-center py-12 text-gray-400">Talep bulunamadı</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-500">
                  <th className="px-4 py-3 font-medium">No</th>
                  <th className="px-4 py-3 font-medium">Konu</th>
                  <th className="px-4 py-3 font-medium">Şirket</th>
                  <th className="px-4 py-3 font-medium">Kategori</th>
                  <th className="px-4 py-3 font-medium">Durum</th>
                  <th className="px-4 py-3 font-medium">Öncelik</th>
                  <th className="px-4 py-3 font-medium">Atanan</th>
                  <th className="px-4 py-3 font-medium">Oluşturan</th>
                  <th className="px-4 py-3 font-medium">Tarih</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map(ticket => (
                  <tr key={ticket.id} className="border-t hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link
                        to={`/staff/tickets/${ticket.id}`}
                        className="text-primary-600 hover:underline font-mono text-xs"
                      >
                        {ticket.ticketNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3 max-w-[250px] truncate font-medium">
                      <Link to={`/staff/tickets/${ticket.id}`} className="hover:text-primary-600">
                        {ticket.subject}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{ticket.company.name}</td>
                    <td className="px-4 py-3 text-gray-500">{ticket.category.name}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[ticket.status] || ''}`}>
                        {STATUS_LABELS[ticket.status] || ticket.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[ticket.priority] || ''}`}>
                        {PRIORITY_LABELS[ticket.priority] || ticket.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {ticket.assignedTo?.fullName || <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{ticket.createdByEmail}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                      {new Date(ticket.createdAt).toLocaleDateString('tr-TR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
            <span className="text-sm text-gray-500">
              Toplam {pagination.total} talep
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1 rounded hover:bg-gray-200 disabled:opacity-30"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="text-sm">
                {page} / {pagination.totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                disabled={page === pagination.totalPages}
                className="p-1 rounded hover:bg-gray-200 disabled:opacity-30"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
