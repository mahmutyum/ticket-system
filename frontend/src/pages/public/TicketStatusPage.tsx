import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dateLocale } from '../../i18n/format';
import axios from 'axios';
import toast from 'react-hot-toast';
import {
  Clock, Building2, MapPin, Tag, User, Send,
  Calendar, MapPinned, Upload, Paperclip, FileText,
} from 'lucide-react';
import { type Ticket } from '../../types';
import { useEnumLabels } from '../../i18n/labels';
import { useTicketSSE } from '../../hooks/useSSE';
import { useQueryClient } from '@tanstack/react-query';
import { publicAttachmentUrl } from '../../utils/download';
import { EmptyState, SkeletonRows } from '../../components/ui/AsyncState';
import { PriorityBadge, StatusBadge } from '../../components/ui/Badge';

export default function TicketStatusPage() {
  const { t } = useTranslation();
  const labels = useEnumLabels();
  const { accessToken } = useParams<{ accessToken: string }>();
  const queryClient = useQueryClient();
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { data: ticket, isLoading, refetch } = useQuery<Ticket>({
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
      toast.success(t('ticketStatus.replySent'));
      refetch();
    } catch {
      toast.error(t('common.error'));
    } finally {
      setSending(false);
    }
  };

  if (isLoading) {
    return <div className="card mx-auto max-w-3xl overflow-hidden p-0"><SkeletonRows rows={7} /></div>;
  }

  if (!ticket) {
    return (
      <div className="card mx-auto max-w-2xl"><EmptyState title={t('ticketStatus.notFoundTitle')} description={t('ticketStatus.notFoundDesc')} /></div>
    );
  }

  const closedStatuses = ['resolved', 'closed'];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="card">
        <div className="flex flex-col items-start justify-between gap-4 mb-5 sm:flex-row">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-600 dark:text-primary-300">{ticket.ticketNumber}</span>
            <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{ticket.subject}</h2>
          </div>
          <div className="flex gap-2">
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
          </div>
        </div>

        <div className="sub-surface grid grid-cols-2 gap-4 p-4 text-sm sm:grid-cols-4">
          <div className="flex items-center gap-2 text-muted">
            <Building2 className="w-4 h-4" />
            <span>{ticket.company.name}</span>
          </div>
          <div className="flex items-center gap-2 text-muted">
            <MapPin className="w-4 h-4" />
            <span>{ticket.location.name}</span>
          </div>
          <div className="flex items-center gap-2 text-muted">
            <Tag className="w-4 h-4" />
            <span>{ticket.category.name}</span>
          </div>
          <div className="flex items-center gap-2 text-muted">
            <Clock className="w-4 h-4" />
            <span>{new Date(ticket.createdAt).toLocaleDateString(dateLocale())}</span>
          </div>
        </div>

        {ticket.assignedTo && (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted">
            <User className="w-4 h-4" />
            <span>{t('common.assignedTo')}: <strong>{ticket.assignedTo.fullName}</strong></span>
          </div>
        )}
      </div>

      {/* Description */}
      <div className="card">
        <h3 className="mb-3 font-semibold">{t('ticketStatus.descriptionTitle')}</h3>
        <p className="whitespace-pre-wrap leading-7">{ticket.description}</p>
      </div>

      {/* Custom field values */}
      {ticket.customValues && ticket.customValues.length > 0 && (
        <div className="card">
          <h3 className="mb-3 font-semibold">{t('ticketStatus.extraInfoTitle')}</h3>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            {ticket.customValues.map(cv => (
              <div key={cv.id} className="sub-surface p-3">
                <span className="block text-xs text-muted">{cv.customField?.fieldLabel}</span>
                <span className="mt-1 block font-medium">{cv.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Onsite support */}
      {ticket.onsiteSupport && ticket.onsiteSupport.length > 0 && (
        <div className="card border-l-4 border-l-orange-400">
          <h3 className="text-sm font-semibold text-orange-600 mb-3 flex items-center gap-2">
            <MapPinned className="w-4 h-4" /> {t('ticketStatus.onsiteTitle')}
          </h3>
          {ticket.onsiteSupport.map(os => (
            <div key={os.id} className="text-sm space-y-1">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted" />
                <span>{new Date(os.scheduledAt).toLocaleString(dateLocale())}</span>
              </div>
              <span className="text-muted">
                {os.type === 'come_to_it_room'
                  ? (os.roomInfo
                      ? t('ticketStatus.comeToItRoomWithInfo', { room: os.roomInfo })
                      : t('ticketStatus.comeToItRoom'))
                  : t('ticketStatus.teamWillCome')}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Timeline */}
      <div className="card">
        <h3 className="mb-4 font-semibold">{t('ticketStatus.timelineTitle')}</h3>
        <div className="space-y-4">
          {ticket.history?.map(h => (
            <div key={h.id || h.createdAt} className="flex gap-3 text-sm">
              <div className="w-2 h-2 rounded-full bg-gray-300 mt-1.5 flex-shrink-0" />
              <div className="flex-1">
                <span className="text-muted">
                  {new Date(h.createdAt).toLocaleString(dateLocale())}
                </span>
                <span className="ml-2">
                  {h.action === 'status_changed' && t('ticketStatus.statusChanged', { from: labels.status(h.oldValue ?? ''), to: labels.status(h.newValue ?? '') })}
                  {h.action === 'ticket_created' && t('ticketStatus.ticketCreated')}
                  {h.action === 'assigned' && t('ticketStatus.assigned')}
                  {h.action === 'user_reply' && t('ticketStatus.userReply', { content: h.newValue })}
                  {h.action === 'note_added' && t('ticketStatus.noteAdded')}
                  {h.action === 'onsite_scheduled' && t('ticketStatus.onsiteScheduled')}
                </span>
              </div>
            </div>
          ))}

          {/* Public notes */}
          {ticket.notes?.map(note => (
            <div key={note.id} className="flex gap-3 text-sm">
              <div className="w-2 h-2 rounded-full bg-primary-400 mt-1.5 flex-shrink-0" />
              <div className="flex-1 rounded-inset bg-primary-50 p-3 dark:bg-primary-500/10">
                <div className="flex justify-between mb-1">
                  <span className="font-medium text-primary-700">{note.createdBy.fullName}</span>
                  <span className="text-muted text-xs">
                    {new Date(note.createdAt).toLocaleString(dateLocale())}
                  </span>
                </div>
                <p>{note.content}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Attachments */}
      {(ticket.attachments?.length ?? 0) > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Paperclip className="w-4 h-4" /> {t('ticketStatus.attachmentsTitle')}
          </h3>
          <div className="space-y-2">
            {ticket.attachments?.map(att => (
              <a
                key={att.id}
                // Ekler artık yetki kontrollü /attachments/:id üzerinden gelir.
                // Talep edenin Bearer token'ı yok — ticket'ın accessToken'ını
                // sunar; sunucu eşleşme ve süre kontrolü yapar.
                href={publicAttachmentUrl(att.id, accessToken!)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-inset p-3 text-sm transition-colors hover:bg-gray-50 dark:hover:bg-slate-800"
              >
                <FileText className="w-4 h-4 text-muted" />
                <span className="flex-1 truncate">{att.fileName}</span>
                <span className="text-xs text-muted">{(att.fileSize / 1024).toFixed(0)} KB</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Reply form + file upload */}
      {!closedStatuses.includes(ticket.status) && (
        <div className="card">
          <h3 className="mb-1 font-semibold">{t('ticketStatus.replyTitle')}</h3>
          <p className="mb-4 text-sm text-muted">{t('ticketStatus.replyDesc')}</p>
          <form onSubmit={handleReply} className="space-y-3">
            <textarea
              className="input-field min-h-[120px]"
              value={reply}
              onChange={e => setReply(e.target.value)}
              placeholder={t('ticketStatus.replyPlaceholder')}
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button type="submit" disabled={sending || !reply.trim()} className="btn-primary flex items-center gap-2">
                <Send className="w-4 h-4" />
                {sending ? t('ticketStatus.sending') : t('ticketStatus.send')}
              </button>
              <label className={`btn-secondary text-sm flex items-center gap-1 cursor-pointer ${uploading ? 'opacity-50' : ''}`}>
                <Upload className="w-4 h-4" />
                {uploading ? t('ticketStatus.uploading') : t('ticketStatus.addFile')}
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
                      toast.success(t('ticketStatus.fileUploaded'));
                    } catch {
                      toast.error(t('ticketStatus.fileUploadError'));
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
