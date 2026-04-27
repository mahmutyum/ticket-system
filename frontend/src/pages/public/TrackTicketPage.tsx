import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
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
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="card">
        <h2 className="text-xl font-bold mb-2">Talep Takip</h2>
        <p className="text-sm text-gray-500 mb-4">
          Talep numaranızı ve email adresinizi girerek talebinizin durumunu görüntüleyebilirsiniz.
        </p>

        <form onSubmit={handleSearch} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Talep Numarası
            </label>
            <input
              type="text"
              className="input-field w-full"
              value={ticketNumber}
              onChange={e => setTicketNumber(e.target.value)}
              placeholder="Örn: TKT-2026-0001"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email Adresi
            </label>
            <input
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
            className="btn-primary flex items-center gap-2 w-full justify-center"
          >
            <Search className="w-4 h-4" />
            {loading ? 'Aranıyor...' : 'Talebi Görüntüle'}
          </button>
        </form>
      </div>
    </div>
  );
}
