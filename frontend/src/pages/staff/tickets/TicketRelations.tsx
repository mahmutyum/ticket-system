import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, GitMerge, Link2, Trash2, Unlink, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import api from '../../../api/client';
import { useAuthStore } from '../../../stores/auth.store';
import { getApiError } from '../../../utils/api-error';
import { StatusBadge } from '../../../components/ui/Badge';
import type { RelatedTicket, Ticket } from '../../../types';

type SearchHit = { id: string; ticketNumber: string; subject: string; status: string };

/** Aynı şirketin ticket'ları arasında arama yapan küçük seçici. */
function TicketPicker({ companyId, excludeId, onPick, placeholder }: {
  companyId: string;
  excludeId: string;
  onPick: (ticket: SearchHit) => void;
  placeholder: string;
}) {
  const [q, setQ] = useState('');
  const { data: hits = [] } = useQuery<SearchHit[]>({
    queryKey: ['ticket-picker', companyId, q],
    queryFn: async () => (await api.get('/tickets/search', { params: { q, companyId } })).data.data,
    enabled: q.trim().length >= 2,
  });
  return (
    <div className="space-y-1">
      <input className="input-field text-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      {hits.filter(h => h.id !== excludeId).slice(0, 6).map(hit => (
        <button key={hit.id} type="button" onClick={() => onPick(hit)}
          className="w-full rounded-control p-2 text-left text-xs hover:bg-gray-50 dark:hover:bg-slate-800/50">
          <span className="font-mono">{hit.ticketNumber}</span> · {hit.subject}
        </button>
      ))}
    </div>
  );
}

const TicketLink = ({ ticket }: { ticket: RelatedTicket }) => (
  <Link to={`/staff/tickets/${ticket.id}`} className="flex items-center justify-between gap-2 rounded-control p-1.5 text-xs hover:bg-gray-50 dark:hover:bg-slate-800/50">
    <span className="min-w-0 truncate"><span className="font-mono">{ticket.ticketNumber}</span> · {ticket.subject}</span>
    <StatusBadge status={ticket.status} />
  </Link>
);

export default function TicketRelations({ ticket }: { ticket: Ticket }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canMerge = user?.role === 'admin' || user?.role === 'it_manager';
  const [mode, setMode] = useState<'none' | 'merge' | 'parent'>('none');
  const [ccEmail, setCcEmail] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id] });

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      await refresh();
      toast.success(success);
      setMode('none');
    } catch (err) {
      toast.error(getApiError(err, t('ticketDetail.relations.failed')));
    }
  };

  const merge = (target: SearchHit) => void run(
    () => api.post(`/tickets/${ticket.id}/merge`, { targetId: target.id }),
    t('ticketDetail.relations.merged', { number: target.ticketNumber }),
  );
  const setParent = (parentId: string | null) => void run(
    () => api.put(`/tickets/${ticket.id}/parent`, { parentId }),
    t('ticketDetail.relations.parentUpdated'),
  );
  const addWatcher = (body: { email: string } | { staffId: string }) => void run(
    async () => { await api.post(`/tickets/${ticket.id}/watchers`, body); setCcEmail(''); },
    t('ticketDetail.relations.watcherAdded'),
  );
  const removeWatcher = (watcherId: string) => void run(
    () => api.delete(`/tickets/${ticket.id}/watchers/${watcherId}`),
    t('ticketDetail.relations.watcherRemoved'),
  );

  const watchers = ticket.watchers ?? [];
  const amWatching = watchers.some(w => w.staffId === user?.id);
  const merged = !!ticket.mergedInto;

  return (
    <div className="card space-y-4 text-sm">
      <h2 className="font-semibold">{t('ticketDetail.relations.title')}</h2>

      {ticket.mergedInto && (
        <div className="rounded-inset border border-blue-200 bg-blue-50 p-2 text-xs dark:border-blue-500/30 dark:bg-blue-500/10">
          {t('ticketDetail.relations.mergedInto')}
          <TicketLink ticket={ticket.mergedInto} />
        </div>
      )}

      {ticket.parent && (
        <div>
          <div className="flex items-center justify-between text-xs text-muted">
            {t('ticketDetail.relations.parent')}
            <button type="button" className="icon-button border-0" onClick={() => setParent(null)} aria-label={t('ticketDetail.relations.unlink')}>
              <Unlink className="h-3.5 w-3.5" />
            </button>
          </div>
          <TicketLink ticket={ticket.parent} />
        </div>
      )}

      {(ticket.children?.length ?? 0) > 0 && (
        <div>
          <p className="text-xs text-muted">{t('ticketDetail.relations.children', { count: ticket.children!.length })}</p>
          {ticket.children!.map(child => <TicketLink key={child.id} ticket={child} />)}
        </div>
      )}

      {(ticket.mergedFrom?.length ?? 0) > 0 && (
        <div>
          <p className="text-xs text-muted">{t('ticketDetail.relations.mergedFrom')}</p>
          {ticket.mergedFrom!.map(src => <TicketLink key={src.id} ticket={src} />)}
        </div>
      )}

      {!merged && (
        <div className="flex flex-wrap gap-2">
          {!ticket.parent && (ticket.children?.length ?? 0) === 0 && (
            <button type="button" className="btn-secondary text-xs" onClick={() => setMode(mode === 'parent' ? 'none' : 'parent')}>
              <Link2 className="mr-1 inline h-3.5 w-3.5" />{t('ticketDetail.relations.linkParent')}
            </button>
          )}
          {canMerge && (
            <button type="button" className="btn-secondary text-xs" onClick={() => setMode(mode === 'merge' ? 'none' : 'merge')}>
              <GitMerge className="mr-1 inline h-3.5 w-3.5" />{t('ticketDetail.relations.merge')}
            </button>
          )}
        </div>
      )}
      {mode === 'parent' && (
        <TicketPicker companyId={ticket.companyId} excludeId={ticket.id} placeholder={t('ticketDetail.relations.searchPlaceholder')}
          onPick={(hit) => setParent(hit.id)} />
      )}
      {mode === 'merge' && (
        <div className="space-y-1">
          <p className="text-xs text-muted">{t('ticketDetail.relations.mergeHint')}</p>
          <TicketPicker companyId={ticket.companyId} excludeId={ticket.id} placeholder={t('ticketDetail.relations.searchPlaceholder')} onPick={merge} />
        </div>
      )}

      <div className="space-y-2 border-t border-subtle pt-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium">{t('ticketDetail.relations.watchers')}</p>
          {user && !amWatching && (
            <button type="button" className="text-xs text-primary-600 hover:underline" onClick={() => addWatcher({ staffId: user.id })}>
              <Eye className="mr-1 inline h-3.5 w-3.5" />{t('ticketDetail.relations.watchMe')}
            </button>
          )}
        </div>
        {watchers.length === 0 && <p className="text-xs text-muted">{t('ticketDetail.relations.noWatchers')}</p>}
        {watchers.map(w => (
          <div key={w.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate">
              {w.staff?.fullName ?? w.email}
              <span className="ml-1 text-muted">({w.staffId ? t('ticketDetail.relations.staffWatcher') : 'CC'})</span>
            </span>
            <button type="button" className="icon-button border-0" onClick={() => removeWatcher(w.id)} aria-label={t('common.delete')}>
              <Trash2 className="h-3.5 w-3.5 text-red-500" />
            </button>
          </div>
        ))}
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (ccEmail) addWatcher({ email: ccEmail }); }}>
          <input type="email" className="input-field text-xs" value={ccEmail} onChange={(e) => setCcEmail(e.target.value)} placeholder={t('ticketDetail.relations.ccPlaceholder')} />
          <button type="submit" className="btn-secondary !px-2" aria-label={t('ticketDetail.relations.addCc')}><UserPlus className="h-4 w-4" /></button>
        </form>
      </div>
    </div>
  );
}
