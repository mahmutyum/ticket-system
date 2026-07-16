import { useState, useMemo } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight, X, SlidersHorizontal, TicketIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { STATUS_LABELS, PRIORITY_LABELS } from '../../types';
import type { Ticket, PaginatedResponse, Staff } from '../../types';
import { useStaffSSE } from '../../hooks/useSSE';
import { useAuthStore } from '../../stores/auth.store';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, SkeletonRows } from '../../components/ui/AsyncState';
import { PriorityBadge, StatusBadge } from '../../components/ui/Badge';

interface BulkResult {
  updated: number;
  requested: number;
  skipped: number;
}

export default function TicketListPage() {
  const queryClient = useQueryClient();
  const role = useAuthStore(s => s.user?.role);
  const canBulk = role === 'admin' || role === 'it_manager';

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkPriority, setBulkPriority] = useState('');
  const [bulkAssignee, setBulkAssignee] = useState<string>('');

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

  const { data: staffList } = useQuery<Staff[]>({
    queryKey: ['staff-list-bulk'],
    queryFn: async () => (await api.get('/staff')).data.data,
    enabled: canBulk,
  });

  const tickets = useMemo(() => data?.data || [], [data?.data]);
  const pagination = data?.pagination;

  const allOnPageSelected = useMemo(
    () => tickets.length > 0 && tickets.every(t => selectedIds.has(t.id)),
    [tickets, selectedIds],
  );

  const toggleAll = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        tickets.forEach(t => next.delete(t.id));
      } else {
        tickets.forEach(t => next.add(t.id));
      }
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setBulkStatus('');
    setBulkPriority('');
    setBulkAssignee('');
  };

  const bulkMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = { ticketIds: Array.from(selectedIds) };
      if (bulkStatus) payload.status = bulkStatus;
      if (bulkPriority) payload.priority = bulkPriority;
      if (bulkAssignee === '__unassign__') payload.assignedToId = null;
      else if (bulkAssignee) payload.assignedToId = bulkAssignee;
      const res = await api.post('/tickets/bulk', payload);
      return res.data.data as BulkResult;
    },
    onSuccess: (result) => {
      const { updated, requested, skipped } = result;
      if (skipped === 0) {
        toast.success(`${updated} talep güncellendi`);
      } else {
        toast(`${updated}/${requested} talep güncellendi, ${skipped} atlandı (yetkisiz)`, { icon: '⚠️' });
      }
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: () => {
      toast.error('Toplu güncelleme başarısız oldu');
    },
  });

  const hasBulkChange = bulkStatus || bulkPriority || bulkAssignee;
  const canApply = canBulk && selectedIds.size > 0 && hasBulkChange && !bulkMutation.isPending;
  const hasFilters = Boolean(search || statusFilter || priorityFilter);

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setPriorityFilter('');
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Destek kuyruğu" title="Talepler" description="Gelen talepleri filtrele, önceliklendir ve ekip içinde yönlendir." />

      {/* Filters */}
      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-primary-600" /><h2 className="text-sm font-semibold">Arama ve filtreler</h2></div>
          {hasFilters && <button type="button" onClick={clearFilters} className="text-sm font-medium text-primary-600 hover:text-primary-700">Tümünü temizle</button>}
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(260px,1fr)_200px_200px]">
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
            className="input-field"
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          >
            <option value="">Tüm Durumlar</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            className="input-field"
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

      {/* Bulk action toolbar */}
      {canBulk && selectedIds.size > 0 && (
        <div className="card border-primary-200 bg-primary-50 shadow-none dark:border-primary-500/20 dark:bg-primary-500/10">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-primary-900 dark:text-primary-100">
              {selectedIds.size} talep seçildi
            </span>
            <select
              className="input-field w-auto text-sm"
              value={bulkStatus}
              onChange={e => setBulkStatus(e.target.value)}
            >
              <option value="">Durum değiştirme</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select
              className="input-field w-auto text-sm"
              value={bulkPriority}
              onChange={e => setBulkPriority(e.target.value)}
            >
              <option value="">Öncelik değiştirme</option>
              {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select
              className="input-field w-auto text-sm"
              value={bulkAssignee}
              onChange={e => setBulkAssignee(e.target.value)}
            >
              <option value="">Atama değiştirme</option>
              <option value="__unassign__">Atamayı kaldır</option>
              {staffList?.map(s => (
                <option key={s.id} value={s.id}>{s.fullName}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => bulkMutation.mutate()}
              disabled={!canApply}
              className="btn-primary text-sm disabled:opacity-50"
            >
              {bulkMutation.isPending ? 'Uygulanıyor...' : 'Uygula'}
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-slate-300 flex items-center gap-1"
            >
              <X className="w-4 h-4" /> Temizle
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        {isLoading ? (
          <SkeletonRows rows={7} />
        ) : tickets.length === 0 ? (
          <EmptyState icon={TicketIcon} title="Talep bulunamadı" description={hasFilters ? 'Arama veya filtreleri değiştirerek tekrar deneyin.' : 'Destek kuyruğunda henüz bir talep yok.'} />
        ) : (
          <>
          <div className="divide-y divide-gray-100 md:hidden dark:divide-slate-800">
            {tickets.map((ticket) => (
              <div key={ticket.id} className="p-4">
                <div className="flex items-start gap-3">
                  {canBulk && <input type="checkbox" className="mt-1" checked={selectedIds.has(ticket.id)} onChange={() => toggleOne(ticket.id)} aria-label={`${ticket.ticketNumber} seç`} />}
                  <Link to={`/staff/tickets/${ticket.id}`} className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs font-semibold text-primary-600">{ticket.ticketNumber}</span><span className="whitespace-nowrap text-xs text-muted">{new Date(ticket.createdAt).toLocaleDateString('tr-TR')}</span></div>
                    <h3 className="mt-1 truncate font-semibold">{ticket.subject}</h3>
                    <p className="mt-1 truncate text-sm text-muted">{ticket.company.name} · {ticket.category.name}</p>
                    <div className="mt-3 flex flex-wrap gap-2"><StatusBadge status={ticket.status} /><PriorityBadge priority={ticket.priority} /></div>
                  </Link>
                </div>
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-[1]">
                <tr className="bg-gray-50 dark:bg-slate-800/50 text-left text-gray-500">
                  {canBulk && (
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={allOnPageSelected}
                        onChange={toggleAll}
                        aria-label="Tümünü seç"
                      />
                    </th>
                  )}
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
                  <tr key={ticket.id} className="border-t hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                    {canBulk && (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(ticket.id)}
                          onChange={() => toggleOne(ticket.id)}
                          aria-label={`${ticket.ticketNumber} seç`}
                        />
                      </td>
                    )}
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
                      <StatusBadge status={ticket.status} />
                    </td>
                    <td className="px-4 py-3">
                      <PriorityBadge priority={ticket.priority} />
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
          </>
        )}

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50 dark:bg-slate-800/50">
            <span className="text-sm text-gray-500">
              Toplam {pagination.total} talep
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="icon-button min-h-9 min-w-9 disabled:opacity-30"
                aria-label="Önceki sayfa"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="text-sm">
                {page} / {pagination.totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                disabled={page === pagination.totalPages}
                className="icon-button min-h-9 min-w-9 disabled:opacity-30"
                aria-label="Sonraki sayfa"
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
