import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Star } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

/**
 * Memnuniyet anketi. E-postadaki yıldız bağlantısı (`?rate=N`) yalnızca puanı
 * ÖNCEDEN SEÇER; kayıt kullanıcı "Gönder"e bastığında yapılır (e-posta tarayıcıları
 * bağlantıları otomatik açabilir).
 */
export default function SatisfactionCard({ accessToken, rating, onRated }: {
  accessToken: string;
  rating: number | null | undefined;
  onRated: () => void;
}) {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const preset = Number(searchParams.get('rate'));
  const [selected, setSelected] = useState(preset >= 1 && preset <= 5 ? preset : 0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.location.hash === '#satisfaction') ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  if (rating) {
    return (
      <div id="satisfaction" ref={ref} className="card text-center">
        <p className="text-sm text-muted">{t('ticketStatus.satisfaction.thanks')}</p>
        <p className="mt-1 text-2xl text-amber-500" aria-label={t('ticketStatus.satisfaction.yourRating', { rating })}>{'★'.repeat(rating)}<span className="text-gray-300 dark:text-slate-600">{'★'.repeat(5 - rating)}</span></p>
      </div>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setSending(true);
    try {
      await axios.post(`/api/public/ticket/${accessToken}/satisfaction`, { rating: selected, ...(comment.trim() ? { comment: comment.trim() } : {}) });
      toast.success(t('ticketStatus.satisfaction.saved'));
      onRated();
    } catch {
      toast.error(t('common.error'));
    } finally {
      setSending(false);
    }
  };

  const shown = hover || selected;
  return (
    <div id="satisfaction" ref={ref} className="card">
      <h3 className="mb-1 font-semibold">{t('ticketStatus.satisfaction.title')}</h3>
      <p className="mb-4 text-sm text-muted">{t('ticketStatus.satisfaction.description')}</p>
      <form onSubmit={e => void submit(e)} className="space-y-3">
        <div className="flex gap-1" role="radiogroup" aria-label={t('ticketStatus.satisfaction.title')} onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} type="button" role="radio" aria-checked={selected === n}
              aria-label={t('ticketStatus.satisfaction.stars', { count: n })}
              onClick={() => setSelected(n)} onMouseEnter={() => setHover(n)}
              className="rounded-control p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500">
              <Star className={`h-8 w-8 ${n <= shown ? 'fill-amber-400 text-amber-400' : 'text-gray-300 dark:text-slate-600'}`} />
            </button>
          ))}
        </div>
        {selected > 0 && <p className="text-sm">{t(`ticketStatus.satisfaction.label${selected}`)}</p>}
        <textarea className="input-field min-h-[80px]" maxLength={1000} value={comment} onChange={e => setComment(e.target.value)}
          placeholder={t('ticketStatus.satisfaction.commentPlaceholder')} />
        <button type="submit" disabled={!selected || sending} className="btn-primary">
          {sending ? t('ticketStatus.sending') : t('ticketStatus.satisfaction.submit')}
        </button>
      </form>
    </div>
  );
}
