import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, LockKeyhole, Search } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';

export default function TrackTicketPage() {
  const navigate = useNavigate();
  const [ticketNumber, setTicketNumber] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketNumber || !email) return;
    setLoading(true);
    try {
      const res = await axios.post('/api/public/track', {
        ticketNumber: ticketNumber.trim(),
        email: email.trim(),
      });
      const accessToken = res.data?.data?.accessToken;
      if (accessToken) {
        navigate(`/ticket/${accessToken}`, { replace: true });
      } else {
        toast.error('Talep bulunamadı');
      }
    } catch (err) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? err.response.data.error
          : 'Talep bulunamadı';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-4xl items-stretch gap-6 py-4 md:grid-cols-[.8fr_1.2fr] md:py-12">
      <div className="rounded-3xl bg-primary-700 p-7 text-white shadow-glow sm:p-8">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15"><KeyRound className="h-6 w-6" /></span>
        <h2 className="mt-6 text-2xl font-bold">Talebine geri dön</h2>
        <p className="mt-3 text-sm leading-6 text-primary-100">Talep numaran ve talebi oluştururken kullandığın e-posta adresi birlikte doğrulanır.</p>
        <div className="mt-8 flex gap-3 rounded-2xl bg-black/10 p-4 text-sm text-primary-50"><LockKeyhole className="mt-0.5 h-5 w-5 shrink-0" /><p>Bilgilerin yalnızca ilgili talebe erişim bağlantısı üretmek için kullanılır.</p></div>
      </div>
      <div className="card p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-600">Talep takip</p>
        <h2 className="mt-2 text-2xl font-bold">Durumu görüntüle</h2>
        <p className="mt-2 mb-6 text-sm text-muted">
          Talep numaranızı ve email adresinizi girerek talebinizin durumunu görüntüleyebilirsiniz.
        </p>

        <form onSubmit={handleSearch} className="space-y-4">
          <div>
            <label htmlFor="track-ticket-number" className="block text-sm font-medium mb-1">
              Talep Numarası
            </label>
            <input
              id="track-ticket-number"
              type="text"
              className="input-field w-full"
              value={ticketNumber}
              onChange={e => setTicketNumber(e.target.value)}
              placeholder="Örn: TKT-2026-0001"
              required
            />
          </div>

          <div>
            <label htmlFor="track-email" className="block text-sm font-medium mb-1">
              Email Adresi
            </label>
            <input
              id="track-email"
              type="email"
              className="input-field w-full"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Email adresinizi girin"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary flex w-full items-center justify-center gap-2 py-3"
          >
            <Search className="w-4 h-4" />
            {loading ? 'Aranıyor...' : 'Talebi Görüntüle'}
          </button>
        </form>
      </div>
    </div>
  );
}
