import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ExternalLink } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { STATUS_LABELS, STATUS_COLORS, PRIORITY_LABELS } from '../../types';

interface TicketSummary {
  id: string;
  ticketNumber: string;
  subject: string;
  status: string;
  priority: string;
  accessToken: string;
  createdAt: string;
  updatedAt: string;
  company: { name: string };
  category: { name: string };
}

export default function TrackTicketPage() {
  const [email, setEmail] = useState('');
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    try {
      const res = await axios.get(`/api/public/tickets?email=${encodeURIComponent(email)}`);
      setTickets(res.data.data);
      if (res.data.data.length === 0) {
        toast('Bu email ile kayıtlı talep bulunamadı', { icon: 'ℹ️' });
      }
    } catch {
      toast.error('Bir hata oluştu');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="card">
        <h2 className="text-xl font-bold mb-2">Talep Takip</h2>
        <p className="text-sm text-gray-500 mb-4">
          Email adresinizi girerek daha önce oluşturduğunuz tüm destek taleplerinizi görüntüleyebilirsiniz.
        </p>

        <form onSubmit={handleSearch} className="flex gap-3">
          <input
            type="email"
            className="input-field flex-1"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Email adresinizi girin"
            required
          />
          <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
            <Search className="w-4 h-4" />
            {loading ? 'Aranıyor...' : 'Ara'}
          </button>
        </form>
      </div>

      {/* Results */}
      {tickets && tickets.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-500">
            {tickets.length} talep bulundu
          </h3>
          {tickets.map(ticket => (
            <Link
              key={ticket.id}
              to={`/ticket/${ticket.accessToken}`}
              className="card block hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-mono text-primary-600">{ticket.ticketNumber}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[ticket.status] || ''}`}>
                      {STATUS_LABELS[ticket.status] || ticket.status}
                    </span>
                  </div>
                  <h4 className="font-medium truncate">{ticket.subject}</h4>
                  <div className="flex gap-3 mt-2 text-xs text-gray-400">
                    <span>{ticket.company.name}</span>
                    <span>{ticket.category.name}</span>
                    <span>{new Date(ticket.createdAt).toLocaleDateString('tr-TR')}</span>
                  </div>
                </div>
                <ExternalLink className="w-4 h-4 text-gray-400 flex-shrink-0 mt-1" />
              </div>
            </Link>
          ))}
        </div>
      )}

      {tickets && tickets.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          Bu email ile kayıtlı talep bulunamadı.
        </div>
      )}
    </div>
  );
}
