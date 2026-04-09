import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import {
  Clock, Building2, MapPin, Tag, User, Send,
  Calendar, MapPinned, Upload, Paperclip, FileText,
} from 'lucide-react';
import { STATUS_LABELS, STATUS_COLORS, PRIORITY_LABELS, PRIORITY_COLORS } from '../../types';
import { useTicketSSE } from '../../hooks/useSSE';
import { useQueryClient } from '@tanstack/react-query';

export default function TicketStatusPage() {
  const { accessToken } = useParams<{ accessToken: string }>();
  const queryClient = useQueryClient();
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { data: ticket, isLoading, refetch } = useQuery({
    queryKey: ['public-ticket', accessToken],
    queryFn: async () => (await axios.get(`/api/public/ticket/${accessToken}`)).data.data,
    enabled: !!accessToken,
  });

  // SSE: live updates for this ticket
  useTicketSSE(accessToken, () => {
    queryClient.invalidateQueries({ queryKey: ['public-ticket', accessToken] });
  });

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    try {
      await axios.post(`/api/public/ticket/${accessToken}/reply`, { content: reply });
      setReply('');
      toast.success('Yanıtınız gönderildi');
      refetch();
    } catch {
      toast.error('Bir hata oluştu');
    } finally {
      setSending(false);
    }
  };

  if (isLoading) {
    return <div className="text-center py-12 text-gray-400">Yükleniyor...</div>;
  }

  if (!ticket) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-bold text-gray-700">Talep Bulunamadı</h2>
        <p className="text-gray-500 mt-2">Geçersiz veya süresi dolmuş bağlantı.</p>
      </div>
    );
  }

  const closedStatuses = ['resolved', 'closed'];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="card">
        <div className="flex items-start justify-between mb-4">
          <div>
            <span className="text-sm font-mono text-primary-600">{ticket.ticketNumber}</span>
            <h2 className="text-xl font-bold mt-1">{ticket.subject}</h2>
          </div>
          <div className="flex gap-2">
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[ticket.status] || ''}`}>
              {STATUS_LABELS[ticket.status] || ticket.status}
            </span>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${PRIORITY_COLORS[ticket.priority] || ''}`}>
              {PRIORITY_LABELS[ticket.priority] || ticket.priority}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div className="flex items-center gap-2 text-gray-500">
            <Building2 className="w-4 h-4" />
            <span>{ticket.company.name}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-500">
            <MapPin className="w-4 h-4" />
            <span>{ticket.location.name}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-500">
            <Tag className="w-4 h-4" />
            <span>{ticket.category.name}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-500">
            <Clock className="w-4 h-4" />
            <span>{new Date(ticket.createdAt).toLocaleDateString('tr-TR')}</span>
          </div>
        </div>

        {ticket.assignedTo && (
          <div className="mt-3 flex items-center gap-2 text-sm text-gray-600">
            <User className="w-4 h-4" />
            <span>Atanan: <strong>{ticket.assignedTo.fullName}</strong></span>
          </div>
        )}
      </div>

      {/* Description */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-500 mb-2">Açıklama</h3>
        <p className="text-gray-800 whitespace-pre-wrap">{ticket.description}</p>
      </div>

      {/* Custom field values */}
      {ticket.customValues && ticket.customValues.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-500 mb-3">Ek Bilgiler</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {ticket.customValues.map((cv: any) => (
              <div key={cv.id}>
                <span className="text-gray-500">{cv.customField.fieldLabel}:</span>
                <span className="ml-2 font-medium">{cv.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Onsite support */}
      {ticket.onsiteSupport && ticket.onsiteSupport.length > 0 && (
        <div className="card border-l-4 border-l-orange-400">
          <h3 className="text-sm font-semibold text-orange-600 mb-3 flex items-center gap-2">
            <MapPinned className="w-4 h-4" /> Yerinde Destek
          </h3>
          {ticket.onsiteSupport.map((os: any, i: number) => (
            <div key={i} className="text-sm space-y-1">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-gray-400" />
                <span>{new Date(os.scheduledAt).toLocaleString('tr-TR')}</span>
              </div>
              <span className="text-gray-600">
                {os.type === 'come_to_it_room'
                  ? `Lütfen IT odasına geliniz${os.roomInfo ? `: ${os.roomInfo}` : ''}`
                  : 'Teknik ekip size gelecek'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Timeline */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-500 mb-4">Süreç Geçmişi</h3>
        <div className="space-y-4">
          {ticket.history?.map((h: any) => (
            <div key={h.id || h.createdAt} className="flex gap-3 text-sm">
              <div className="w-2 h-2 rounded-full bg-gray-300 mt-1.5 flex-shrink-0" />
              <div className="flex-1">
                <span className="text-gray-500">
                  {new Date(h.createdAt).toLocaleString('tr-TR')}
                </span>
                <span className="ml-2 text-gray-700">
                  {h.action === 'status_changed' && `Durum değişti: ${STATUS_LABELS[h.oldValue] || h.oldValue} → ${STATUS_LABELS[h.newValue] || h.newValue}`}
                  {h.action === 'ticket_created' && 'Talep oluşturuldu'}
                  {h.action === 'assigned' && 'Talep atandı'}
                  {h.action === 'user_reply' && `Kullanıcı yanıtı: ${h.newValue}`}
                  {h.action === 'note_added' && 'Not eklendi'}
                  {h.action === 'onsite_scheduled' && 'Yerinde destek planlandı'}
                </span>
              </div>
            </div>
          ))}

          {/* Public notes */}
          {ticket.notes?.map((note: any) => (
            <div key={note.id} className="flex gap-3 text-sm">
              <div className="w-2 h-2 rounded-full bg-primary-400 mt-1.5 flex-shrink-0" />
              <div className="flex-1 bg-primary-50 rounded-lg p-3">
                <div className="flex justify-between mb-1">
                  <span className="font-medium text-primary-700">{note.createdBy.fullName}</span>
                  <span className="text-gray-400 text-xs">
                    {new Date(note.createdAt).toLocaleString('tr-TR')}
                  </span>
                </div>
                <p className="text-gray-700">{note.content}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Attachments */}
      {ticket.attachments?.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-500 mb-3 flex items-center gap-2">
            <Paperclip className="w-4 h-4" /> Dosyalar
          </h3>
          <div className="space-y-2">
            {ticket.attachments.map((att: any) => (
              <a
                key={att.id}
                href={`/uploads/${att.filePath}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 text-sm"
              >
                <FileText className="w-4 h-4 text-gray-400" />
                <span className="flex-1 truncate">{att.fileName}</span>
                <span className="text-xs text-gray-400">{(att.fileSize / 1024).toFixed(0)} KB</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Reply form + file upload */}
      {!closedStatuses.includes(ticket.status) && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-500 mb-3">Yanıt Gönder</h3>
          <form onSubmit={handleReply} className="space-y-3">
            <textarea
              className="input-field min-h-[80px]"
              value={reply}
              onChange={e => setReply(e.target.value)}
              placeholder="Mesajınızı yazın..."
            />
            <div className="flex items-center gap-3">
              <button type="submit" disabled={sending || !reply.trim()} className="btn-primary flex items-center gap-2">
                <Send className="w-4 h-4" />
                {sending ? 'Gönderiliyor...' : 'Gönder'}
              </button>
              <label className={`btn-secondary text-sm flex items-center gap-1 cursor-pointer ${uploading ? 'opacity-50' : ''}`}>
                <Upload className="w-4 h-4" />
                {uploading ? 'Yükleniyor...' : 'Dosya Ekle'}
                <input
                  type="file"
                  className="hidden"
                  disabled={uploading}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setUploading(true);
                    try {
                      const formData = new FormData();
                      formData.append('file', file);
                      await axios.post(`/api/public/ticket/${accessToken}/attachments`, formData, {
                        headers: { 'Content-Type': 'multipart/form-data' },
                      });
                      refetch();
                      toast.success('Dosya yüklendi');
                    } catch {
                      toast.error('Dosya yüklenemedi');
                    } finally {
                      setUploading(false);
                      e.target.value = '';
                    }
                  }}
                />
              </label>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
