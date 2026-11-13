import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { keepPreviousData } from '@tanstack/react-query';
import axios from 'axios';
import { MailCheck, SearchX } from 'lucide-react';
import { useEnumLabels } from '../../../i18n/labels';
import { dateLocale } from '../../../i18n/format';

type TicketRow = {
  id: string;
  ticketNumber: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  accessToken: string;
  company: { name: string };
};

/**
 * "Taleplerim" (v1.3) — talep sahibi e-postasını girer, gelen kısa ömürlü
 * bağlantı ile tüm taleplerini tek listede görür. Parola yok: e-posta
 * sahipliği doğrulanır (`?token=` bağlantısı mail ile gelir, 15 dakika yaşar).
 */
export default function MyTicketsPage() {
  const { t, i18n } = useTranslation();
  const labels = useEnumLabels();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  const requestLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setSending(true);
    setSendError('');
    try {
      await axios.post('/api/public/my-tickets/link', {
        email,
        locale: i18n.language.startsWith('en') ? 'en' : 'tr',
      });
      setSent(true);
    } catch {
      setSendError(t('myTickets.sendFailed'));
    } finally {
      setSending(false);
    }
  };

  // Token'lı görünüm: liste sorgusu. 404 (süre doldu) → ayrı durum.
  const { data } = useQuery({
    queryKey: ['my-tickets', token],
    enabled: !!token,
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: async () => {
      try {
        const res = await axios.get(`/api/public/my-tickets/${token}`);
        return { ok: true as const, email: res.data.data.email as string, tickets: res.data.data.tickets as TicketRow[] };
      } catch (err) {
        const status = (err as { response?: { status?: number } }).response?.status;
        if (status === 404) return { ok: false as const, email: '', tickets: [] };
        throw err;
      }
    },
  });

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="card space-y-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-inset bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-300">
            {token ? <MailCheck className="h-5 w-5" /> : <SearchX className="h-5 w-5" />}
          </span>
          <div>
            <h1 className="text-lg font-semibold">{t('myTickets.title')}</h1>
            <p className="text-sm text-muted">{t('myTickets.subtitle')}</p>
          </div>
        </div>

        {token ? (
          data?.ok ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                {t('myTickets.listIntro', { email: data.email, count: data.tickets.length })}
              </p>
              {data.tickets.length === 0 && (
                <p className="rounded-inset border border-subtle px-4 py-6 text-center text-sm text-muted">
                  {t('myTickets.noTickets')}
                </p>
              )}
              <ul className="divide-y divide-gray-100 dark:divide-slate-800">
                {data.tickets.map((ticket) => (
                  <li key={ticket.id} className="py-3">
                    <Link to={`/ticket/${ticket.accessToken}`} className="block rounded-inset p-2 hover:bg-gray-50 dark:hover:bg-slate-800/50">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-primary-600">{ticket.ticketNumber}</span>
                        <span className="text-xs text-muted">{new Date(ticket.createdAt).toLocaleDateString(dateLocale())}</span>
                      </div>
                      <p className="mt-1 font-medium">{ticket.subject}</p>
                      <p className="mt-1 text-xs text-muted">
                        {ticket.company.name} · {labels.status(ticket.status)} · {labels.priority(ticket.priority)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : data && !data.ok ? (
            <div className="space-y-3">
              <p className="text-sm text-red-600">{t('myTickets.expired')}</p>
              <EmailForm email={email} setEmail={setEmail} sending={sending} sendError={sendError} onSubmit={requestLink} submitLabel={t('myTickets.request')} />
            </div>
          ) : (
            <p className="text-sm text-muted">{t('common.loading')}</p>
          )
        ) : sent ? (
          <div className="space-y-2">
            <p className="text-sm">{t('myTickets.sent', { email })}</p>
            <p className="text-xs text-muted">{t('myTickets.sentHint')}</p>
            <button type="button" className="btn-secondary text-sm" onClick={() => setSent(false)}>
              {t('myTickets.requestAgain')}
            </button>
          </div>
        ) : (
          <EmailForm email={email} setEmail={setEmail} sending={sending} sendError={sendError} onSubmit={requestLink} submitLabel={t('myTickets.request')} />
        )}
      </div>
    </div>
  );
}

function EmailForm({
  email, setEmail, sending, sendError, onSubmit, submitLabel,
}: {
  email: string;
  setEmail: (value: string) => void;
  sending: boolean;
  sendError: string;
  onSubmit: (event: React.FormEvent) => void;
  submitLabel: string;
}) {
  const { t } = useTranslation();
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium" htmlFor="my-email">{t('myTickets.emailLabel')}</label>
        <input id="my-email" type="email" className="input-field" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="ad@firma.com" required maxLength={254} />
        <p className="mt-1 text-xs text-muted">{t('myTickets.emailHint')}</p>
      </div>
      {sendError && <p className="text-sm text-red-600">{sendError}</p>}
      <button type="submit" className="btn-primary w-full" disabled={sending}>
        {sending ? t('common.loading') : submitLabel}
      </button>
    </form>
  );
}
