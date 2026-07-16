import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ArrowLeft, Clock, Building2, MapPin, Tag, User, Phone, Mail,
  MessageSquare, Lock, Send, Paperclip, Upload, FileText,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { dateLocale } from '../../i18n/format';
import api from '../../api/client';
import { useEnumLabels } from '../../i18n/labels';
import type { CannedResponse, Staff, Ticket } from '../../types';
import { downloadAttachment } from '../../utils/download';
import TicketTimeline from './tickets/TicketTimeline';
import { PageHeader } from '../../components/ui/PageHeader';
import { SkeletonRows } from '../../components/ui/AsyncState';
import { PriorityBadge, StatusBadge } from '../../components/ui/Badge';

export default function TicketDetailPage() {
  const { t } = useTranslation();
  const labels = useEnumLabels();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [noteContent, setNoteContent] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showCanned, setShowCanned] = useState(false);
  const [showOnsiteForm, setShowOnsiteForm] = useState(false);
  const [onsiteForm, setOnsiteForm] = useState({ type: 'come_to_it_room', scheduledAt: '', durationMin: 15, roomInfo: '', notes: '' });

  const { data: ticket, isLoading } = useQuery<Ticket>({
    queryKey: ['ticket', id],
    queryFn: async () => (await api.get(`/tickets/${id}`)).data.data,
    enabled: !!id,
  });

  // Staff list filtered by ticket's company
  const { data: staffList } = useQuery<Staff[]>({
    queryKey: ['staff-list', ticket?.companyId],
    queryFn: async () => {
      const params = ticket?.companyId ? `?companyId=${ticket.companyId}` : '';
      return (await api.get(`/staff${params}`)).data.data;
    },
    enabled: !!ticket,
  });

  const { data: cannedResponses } = useQuery<CannedResponse[]>({
    queryKey: ['canned-responses'],
    queryFn: async () => (await api.get('/templates/canned')).data.data,
  });

  const handleStatusChange = async (status: string) => {
    try {
      await api.put(`/tickets/${id}`, { status });
      queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      toast.success(t('ticketDetail.statusUpdated'));
    } catch {
      toast.error(t('ticketDetail.updateFailed'));
    }
  };

  const handlePriorityChange = async (priority: string) => {
    try {
      await api.put(`/tickets/${id}`, { priority });
      queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      toast.success(t('ticketDetail.priorityUpdated'));
    } catch {
      toast.error(t('ticketDetail.updateFailed'));
    }
  };

  const handleAssign = async (assignedToId: string | null) => {
    try {
      await api.put(`/tickets/${id}`, { assignedToId });
      queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      toast.success(t('ticketDetail.assignUpdated'));
    } catch {
      toast.error(t('ticketDetail.assignFailed'));
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteContent.trim()) return;
    setSending(true);
    try {
      await api.post(`/tickets/${id}/notes`, { content: noteContent, isInternal });
      setNoteContent('');
      queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      toast.success(isInternal ? t('ticketDetail.internalNoteAdded') : t('ticketDetail.noteAdded'));
    } catch {
      toast.error(t('ticketDetail.noteFailed'));
    } finally {
      setSending(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await api.post(`/tickets/${id}/attachments`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      toast.success(t('ticketDetail.fileUploaded'));
    } catch {
      toast.error(t('ticketDetail.fileUploadFailed'));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  if (isLoading || !ticket) {
    return <div className="card overflow-hidden p-0"><SkeletonRows rows={8} /></div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={ticket.ticketNumber}
        title={ticket.subject}
        description={`${ticket.company?.name} · ${ticket.category?.name} · ${new Date(ticket.createdAt).toLocaleString(dateLocale())}`}
        actions={<><StatusBadge status={ticket.status} /><PriorityBadge priority={ticket.priority} /><Link to="/staff/tickets" className="icon-button" aria-label={t('ticketDetail.backToList')}><ArrowLeft className="w-5 h-5" /></Link></>}
      />

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main content - 2 cols */}
        <div className="lg:col-span-2 space-y-6">
          {/* Description */}
          <div className="card">
            <h2 className="mb-3 text-base font-semibold">{t('ticketDetail.descriptionTitle')}</h2>
            <p className="text-gray-800 dark:text-slate-200 whitespace-pre-wrap">{ticket.description}</p>
          </div>

          {/* Custom fields */}
          {(ticket.customValues?.length ?? 0) > 0 && (
            <div className="card">
              <h2 className="mb-3 text-base font-semibold">{t('ticketDetail.additionalInfo')}</h2>
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                {ticket.customValues?.map(cv => (
                  <div key={cv.id} className="surface-2 rounded-xl p-3">
                    <span className="text-gray-500 text-xs">{cv.customField?.fieldLabel}</span>
                    <p className="font-medium mt-0.5">{cv.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Attachments */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold flex items-center gap-2">
                <Paperclip className="w-4 h-4" /> {t('ticketDetail.files')}
                {(ticket.attachments?.length ?? 0) > 0 && (
                  <span className="bg-gray-200 text-gray-600 dark:text-slate-400 text-xs px-1.5 rounded-full">{ticket.attachments?.length}</span>
                )}
              </h2>
              <label className={`btn-secondary text-xs flex items-center gap-1 cursor-pointer ${uploading ? 'opacity-50' : ''}`}>
                <Upload className="w-3 h-3" />
                {uploading ? t('ticketDetail.uploading') : t('ticketDetail.addFile')}
                <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploading} />
              </label>
            </div>
            {(ticket.attachments?.length ?? 0) > 0 ? (
              <div className="space-y-2">
                {ticket.attachments?.map(att => (
                  <button
                    key={att.id}
                    type="button"
                    // <a href> Authorization header'ı gönderemez; ek artık yetki
                    // kontrollü bir uçtan geliyor, bu yüzden axios ile çekilir.
                    onClick={() => {
                      downloadAttachment(att.id, att.fileName).catch(() =>
                        toast.error(t('ticketDetail.downloadFailed')),
                      );
                    }}
                    className="w-full text-left flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800/50 text-sm"
                  >
                    <FileText className="w-4 h-4 text-gray-400" />
                    <span className="flex-1 truncate">{att.fileName}</span>
                    <span className="text-xs text-gray-400">{(att.fileSize / 1024).toFixed(0)} KB</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="rounded-xl surface-2 px-4 py-6 text-center text-sm text-muted">{t('ticketDetail.noFiles')}</p>
            )}
          </div>

          {/* Timeline */}
          <div className="card">
            <h2 className="mb-4 text-base font-semibold">{t('ticketDetail.activityAndNotes')}</h2>
            <TicketTimeline history={ticket.history} notes={ticket.notes} />

            {/* Add note form */}
            <form onSubmit={handleAddNote} className="mt-6 pt-4 border-t space-y-3">
              {/* Canned response picker */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowCanned(!showCanned)}
                  className="text-xs text-primary-600 hover:underline mb-2"
                >
                  {t('ticketDetail.cannedResponses')} {showCanned ? '▲' : '▼'}
                </button>
                {showCanned && cannedResponses && (
                  <div className="absolute z-10 w-full max-h-48 overflow-y-auto rounded-xl border border-subtle bg-white p-2 shadow-lg dark:bg-slate-900">
                    {cannedResponses.map(cr => (
                      <button
                        key={cr.id}
                        type="button"
                        onClick={() => { setNoteContent(cr.content); setShowCanned(false); }}
                        className="w-full text-left p-2 hover:bg-gray-50 dark:hover:bg-slate-800/50 rounded text-sm"
                      >
                        <span className="font-medium">{cr.title}</span>
                        {cr.category && <span className="text-xs text-gray-400 ml-2">[{cr.category}]</span>}
                        <p className="text-xs text-gray-500 truncate">{cr.content}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 mb-2 rounded-xl surface-2 p-1">
                <label className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm cursor-pointer ${!isInternal ? 'bg-white shadow-sm dark:bg-slate-700' : ''}`}>
                  <input
                    type="radio"
                    checked={!isInternal}
                    onChange={() => setIsInternal(false)}
                    className="text-primary-600"
                  />
                  <MessageSquare className="w-4 h-4" /> {t('ticketDetail.publicNote')}
                </label>
                <label className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm cursor-pointer ${isInternal ? 'bg-amber-100 text-amber-900 shadow-sm dark:bg-amber-500/20 dark:text-amber-200' : ''}`}>
                  <input
                    type="radio"
                    checked={isInternal}
                    onChange={() => setIsInternal(true)}
                    className="text-yellow-600"
                  />
                  <Lock className="w-4 h-4" /> {t('ticketDetail.internalNote')}
                </label>
              </div>
              <textarea
                className={`input-field min-h-[100px] ${isInternal ? 'border-amber-300 bg-amber-50 dark:border-amber-500/50 dark:bg-amber-500/10' : ''}`}
                value={noteContent}
                onChange={e => setNoteContent(e.target.value)}
                placeholder={isInternal ? t('ticketDetail.internalNotePlaceholder') : t('ticketDetail.notePlaceholder')}
              />
              <button type="submit" disabled={sending || !noteContent.trim()} className="btn-primary flex items-center gap-2">
                <Send className="w-4 h-4" />
                {sending ? t('ticketDetail.sending') : t('ticketDetail.addNote')}
              </button>
            </form>
          </div>
        </div>

        {/* Sidebar - 1 col */}
        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          {/* Ticket info */}
          <div className="card space-y-4">
            <h2 className="font-semibold">{t('ticketDetail.ticketInfo')}</h2>

            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-gray-400" />
                <span>{ticket.company?.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-gray-400" />
                <span>{ticket.location?.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <Tag className="w-4 h-4 text-gray-400" />
                <span>{ticket.category?.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-gray-400" />
                <span>{new Date(ticket.createdAt).toLocaleString(dateLocale())}</span>
              </div>
            </div>

            <hr />

            {/* Created by */}
            <div>
              <span className="text-xs text-gray-500 block mb-1">{t('ticketDetail.createdBy')}</span>
              <div className="flex items-center gap-2 text-sm">
                <Mail className="w-4 h-4 text-gray-400" />
                <span>{ticket.createdByEmail}</span>
              </div>
              {ticket.createdBy?.fullName && (
                <div className="flex items-center gap-2 text-sm mt-1">
                  <User className="w-4 h-4 text-gray-400" />
                  <span>{ticket.createdBy.fullName}</span>
                </div>
              )}
              {ticket.createdBy?.phone && (
                <div className="flex items-center gap-2 text-sm mt-1">
                  <Phone className="w-4 h-4 text-gray-400" />
                  <span>{ticket.createdBy.phone}</span>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="card space-y-4">
            <div><h2 className="font-semibold">{t('ticketDetail.quickActions')}</h2><p className="mt-1 text-xs text-muted">{t('ticketDetail.autoSaveHint')}</p></div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">{t('common.status')}</label>
              <select
                className="input-field text-sm"
                value={ticket.status}
                onChange={e => handleStatusChange(e.target.value)}
              >
                {(['open', 'in_progress', 'waiting_user_response', 'waiting_other_department', 'topic_transferred', 'process_outside_it', 'on_hold', 'resolved', 'closed'] as const).map(k => (
                  <option key={k} value={k}>{labels.status(k)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">{t('common.priority')}</label>
              <select
                className="input-field text-sm"
                value={ticket.priority}
                onChange={e => handlePriorityChange(e.target.value)}
              >
                {(['low', 'medium', 'high', 'critical'] as const).map(k => (
                  <option key={k} value={k}>{labels.priority(k)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">{t('ticketDetail.assignedPerson')}</label>
              <select
                className="input-field text-sm"
                value={ticket.assignedToId || ''}
                onChange={e => handleAssign(e.target.value || null)}
              >
                <option value="">{t('common.unassigned')}</option>
                {staffList?.map(s => (
                  <option key={s.id} value={s.id}>{s.fullName}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Onsite support */}
          <div className="card space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <MapPin className="w-4 h-4" /> {t('ticketDetail.onsiteSupport')}
            </h2>

            {(ticket.onsiteSupport?.length ?? 0) > 0 && (
              <div className="space-y-2 text-xs">
                {ticket.onsiteSupport?.map(os => (
                  <div key={os.id} className="rounded-xl bg-orange-50 p-3 dark:bg-orange-500/10">
                    <div className="font-medium">{t(`ticketDetail.onsiteType.${os.type}`, { defaultValue: t('ticketDetail.onsiteType.visit_employee') })}</div>
                    <div className="text-gray-500">{new Date(os.scheduledAt).toLocaleString(dateLocale())}</div>
                    <div className="text-gray-500">{os.location?.name}</div>
                  </div>
                ))}
              </div>
            )}

            {!showOnsiteForm ? (
              <button onClick={() => setShowOnsiteForm(true)} className="btn-secondary text-xs w-full">
                {t('ticketDetail.createAppointment')}
              </button>
            ) : (
              <div className="space-y-2">
                <select
                  className="input-field text-sm"
                  value={onsiteForm.type}
                  onChange={e => setOnsiteForm({ ...onsiteForm, type: e.target.value })}
                >
                  <option value="come_to_it_room">{t('ticketDetail.onsiteType.come_to_it_room')}</option>
                  <option value="meeting_room">{t('ticketDetail.onsiteType.meeting_room')}</option>
                  <option value="visit_employee">{t('ticketDetail.onsiteType.visit_employee')}</option>
                </select>
                <input
                  type="datetime-local"
                  className="input-field text-sm"
                  value={onsiteForm.scheduledAt}
                  onChange={e => setOnsiteForm({ ...onsiteForm, scheduledAt: e.target.value })}
                />
                <select
                  className="input-field text-sm"
                  value={onsiteForm.durationMin}
                  onChange={e => setOnsiteForm({ ...onsiteForm, durationMin: Number(e.target.value) })}
                >
                  <option value={10}>{t('ticketDetail.minutes', { count: 10 })}</option>
                  <option value={15}>{t('ticketDetail.minutes', { count: 15 })}</option>
                  <option value={30}>{t('ticketDetail.minutes', { count: 30 })}</option>
                  <option value={60}>{t('ticketDetail.minutes', { count: 60 })}</option>
                </select>
                {(onsiteForm.type === 'come_to_it_room' || onsiteForm.type === 'meeting_room') && (
                  <input
                    type="text"
                    className="input-field text-sm"
                    placeholder={onsiteForm.type === 'meeting_room' ? t('ticketDetail.meetingRoomInfo') : t('ticketDetail.roomInfo')}
                    value={onsiteForm.roomInfo}
                    onChange={e => setOnsiteForm({ ...onsiteForm, roomInfo: e.target.value })}
                  />
                )}
                <textarea
                  className="input-field text-sm"
                  placeholder={t('ticketDetail.appointmentNotesPlaceholder')}
                  rows={2}
                  value={onsiteForm.notes}
                  onChange={e => setOnsiteForm({ ...onsiteForm, notes: e.target.value })}
                />
                <div className="flex gap-2">
                  <button
                    className="btn-primary text-xs flex-1"
                    onClick={async () => {
                      try {
                        await api.post('/onsite-support', {
                          ticketId: id,
                          locationId: ticket.locationId,
                          type: onsiteForm.type,
                          scheduledAt: new Date(onsiteForm.scheduledAt).toISOString(),
                          scheduledEnd: new Date(
                            new Date(onsiteForm.scheduledAt).getTime() + onsiteForm.durationMin * 60000,
                          ).toISOString(),
                          roomInfo: onsiteForm.roomInfo || undefined,
                          notes: onsiteForm.notes || undefined,
                        });
                        queryClient.invalidateQueries({ queryKey: ['ticket', id] });
                        setShowOnsiteForm(false);
                        setOnsiteForm({ type: 'come_to_it_room', scheduledAt: '', durationMin: 15, roomInfo: '', notes: '' });
                        toast.success(t('ticketDetail.appointmentCreated'));
                      } catch {
                        toast.error(t('ticketDetail.appointmentFailed'));
                      }
                    }}
                    disabled={!onsiteForm.scheduledAt}
                  >
                    {t('common.create')}
                  </button>
                  <button className="btn-secondary text-xs flex-1" onClick={() => setShowOnsiteForm(false)}>
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* SLA info */}
          {(ticket.slaResponseDue || ticket.slaResolveDue) && (
            <div className="card space-y-2 text-sm">
              <h2 className="font-semibold">{t('ticketDetail.slaTargets')}</h2>
              {ticket.slaResponseDue && (
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('ticketDetail.responseTime')}</span>
                  <span className={ticket.slaResponseMet === false ? 'text-red-600 font-medium' : ''}>
                    {new Date(ticket.slaResponseDue).toLocaleString(dateLocale())}
                  </span>
                </div>
              )}
              {ticket.slaResolveDue && (
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('ticketDetail.resolveTime')}</span>
                  <span className={ticket.slaResolveMet === false ? 'text-red-600 font-medium' : ''}>
                    {new Date(ticket.slaResolveDue).toLocaleString(dateLocale())}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
