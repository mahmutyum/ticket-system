import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';
import api from '../../../api/client';
import { dateLocale } from '../../../i18n/format';

type Row = { id: string | null; name: string | null; count: number; average: number | null };
type SatisfactionReport = {
  count: number;
  average: number | null;
  surveysSent: number;
  responseRate: number | null;
  distribution: Array<{ rating: number; count: number }>;
  byStaff: Row[];
  byCategory: Row[];
  byCompany: Row[];
  recentComments: Array<{ ticketId: string; ticketNumber: string; rating: number; comment: string; at: string | null }>;
};

function Breakdown({ title, rows, fallback }: { title: string; rows: Row[]; fallback: string }) {
  return (
    <div className="card">
      <h3 className="mb-3 font-semibold">{title}</h3>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(r => (
            <tr key={r.id ?? 'none'} className="border-t first:border-0">
              <td className="py-1.5">{r.name ?? fallback}</td>
              <td className="py-1.5 text-right text-muted">{r.count}</td>
              <td className="w-16 py-1.5 text-right font-semibold text-amber-600">{r.average ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SatisfactionReportTab({ query }: { query: string }) {
  const { t } = useTranslation();
  const { data } = useQuery<SatisfactionReport>({
    queryKey: ['reports-satisfaction', query],
    queryFn: async () => (await api.get(`/reports/satisfaction?${query}`)).data.data,
  });
  if (!data) return null;
  const max = Math.max(1, ...data.distribution.map(d => d.count));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="card text-center">
          <Star className="mx-auto mb-2 h-8 w-8 fill-amber-400 text-amber-400" />
          <p className="text-3xl font-bold">{data.average ?? '—'}</p>
          <p className="text-sm text-muted">{t('reports.csat.average')}</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold">{data.count}</p>
          <p className="text-sm text-muted">{t('reports.csat.responses')}</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold">{data.responseRate === null ? '—' : `%${data.responseRate}`}</p>
          <p className="text-sm text-muted">{t('reports.csat.responseRate', { sent: data.surveysSent })}</p>
        </div>
      </div>

      <div className="card">
        <h3 className="mb-3 font-semibold">{t('reports.csat.distribution')}</h3>
        <div className="space-y-1.5">
          {[...data.distribution].reverse().map(d => (
            <div key={d.rating} className="flex items-center gap-3 text-sm">
              <span className="w-24 text-amber-500">{'★'.repeat(d.rating)}</span>
              <div className="h-3 flex-1 rounded-full bg-gray-100 dark:bg-slate-800">
                <div className="h-3 rounded-full bg-amber-400" style={{ width: `${(d.count / max) * 100}%` }} />
              </div>
              <span className="w-10 text-right text-muted">{d.count}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Breakdown title={t('reports.csat.byStaff')} rows={data.byStaff} fallback={t('common.unassigned')} />
        <Breakdown title={t('reports.csat.byCategory')} rows={data.byCategory} fallback="—" />
        <Breakdown title={t('reports.csat.byCompany')} rows={data.byCompany} fallback="—" />
      </div>

      <div className="card">
        <h3 className="mb-3 font-semibold">{t('reports.csat.comments')}</h3>
        {data.recentComments.length === 0 && <p className="text-sm text-muted">{t('reports.csat.noComments')}</p>}
        <ul className="divide-y divide-gray-100 dark:divide-slate-800">
          {data.recentComments.map(c => (
            <li key={c.ticketId} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <Link to={`/staff/tickets/${c.ticketId}`} className="font-mono text-xs hover:underline">{c.ticketNumber}</Link>
                <span className="text-amber-500">{'★'.repeat(c.rating)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap">{c.comment}</p>
              {c.at && <p className="text-xs text-muted">{new Date(c.at).toLocaleString(dateLocale())}</p>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
