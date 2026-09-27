import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api/client';

type Hit = { id: string; titleTr: string; titleEn: string | null; isPublished: boolean };

/** Ticket notuna yayındaki bir KB makalesinin başlığını + portal bağlantısını ekler. */
export default function KbInsert({ companyId, onInsert }: { companyId: string; onInsert: (text: string) => void }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const { data: hits = [] } = useQuery<Hit[]>({
    queryKey: ['kb-insert', companyId, q],
    queryFn: async () => (await api.get('/kb', { params: { companyId, ...(q.trim().length >= 2 ? { q } : {}) } })).data.data,
    enabled: open,
  });
  const published = hits.filter(h => h.isPublished).slice(0, 8);
  const title = (h: Hit) => (i18n.language.startsWith('en') && h.titleEn ? h.titleEn : h.titleTr);

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="mb-2 text-xs text-primary-600 hover:underline" title={t('kb.staff.insertHint')}>
        {t('kb.staff.insert')} {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="absolute z-10 w-full space-y-1 rounded-inset border border-subtle bg-white p-2 shadow-overlay dark:bg-slate-900">
          <input className="input-field text-xs" value={q} onChange={e => setQ(e.target.value)} placeholder={t('kb.staff.search')} autoFocus />
          {published.map(h => (
            <button key={h.id} type="button" className="w-full rounded p-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-800/50"
              onClick={() => { onInsert(`${title(h)}: ${window.location.origin}/kb/${h.id}?c=${companyId}`); setOpen(false); }}>
              {title(h)}
            </button>
          ))}
          {published.length === 0 && <p className="p-2 text-xs text-muted">{t('kb.empty')}</p>}
        </div>
      )}
    </div>
  );
}
