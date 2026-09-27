import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Monitor, Unlink } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../api/client';
import { getApiError } from '../../../utils/api-error';
import type { Ticket } from '../../../types';

type AssetHit = { id: string; tag: string; name: string; assetType: string; assignedToEmail: string | null };

/** Ticket'ın ilgili cihazı. Talep sahibine zimmetli varlıklar önce önerilir. */
export default function TicketAsset({ ticket }: { ticket: Ticket }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const { data: hits = [] } = useQuery<AssetHit[]>({
    queryKey: ['asset-pick', ticket.companyId, q, ticket.createdByEmail],
    queryFn: async () => (await api.get('/assets', {
      params: { companyId: ticket.companyId, ...(q.trim().length >= 2 ? { q } : { assignedToEmail: ticket.createdByEmail }) },
    })).data.data,
    enabled: picking,
  });

  const link = async (assetId: string | null) => {
    try {
      await api.put(`/tickets/${ticket.id}/asset`, { assetId });
      await queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id] });
      setPicking(false);
    } catch (err) {
      toast.error(getApiError(err, t('assets.failed')));
    }
  };

  return (
    <div className="card space-y-2 text-sm">
      <h2 className="flex items-center gap-2 font-semibold"><Monitor className="h-4 w-4" /> {t('assets.ticketAsset')}</h2>
      {ticket.asset ? (
        <div className="flex items-center justify-between gap-2">
          <span><span className="font-mono text-xs">{ticket.asset.tag}</span> · {ticket.asset.name} <span className="text-xs text-muted">({ticket.asset.assetType})</span></span>
          <button className="icon-button border-0" aria-label={t('assets.unlink')} onClick={() => void link(null)}><Unlink className="h-4 w-4" /></button>
        </div>
      ) : (
        <p className="text-xs text-muted">{t('assets.noAsset')}</p>
      )}
      <button type="button" className="btn-secondary w-full text-xs" onClick={() => setPicking(!picking)}>{t('assets.pick')}</button>
      {picking && (
        <div className="space-y-1">
          <input className="input-field text-xs" value={q} onChange={e => setQ(e.target.value)} placeholder={t('assets.search')} autoFocus />
          {q.trim().length < 2 && hits.length > 0 && <p className="text-[11px] text-muted">{t('assets.assignedToRequester')}</p>}
          {hits.slice(0, 8).map(h => (
            <button key={h.id} type="button" className="w-full rounded p-1.5 text-left text-xs hover:bg-gray-50 dark:hover:bg-slate-800/50" onClick={() => void link(h.id)}>
              <span className="font-mono">{h.tag}</span> · {h.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
