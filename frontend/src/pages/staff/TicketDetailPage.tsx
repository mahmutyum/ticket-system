import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ArrowLeft, Clock, Building2, MapPin, Tag, User, Phone, Mail,
  MessageSquare, Lock, Send, Paperclip, Upload, FileText,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import {
  STATUS_LABELS, STATUS_COLORS, PRIORITY_LABELS, PRIORITY_COLORS,
} from '../../types';

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [noteContent, setNoteContent] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showCanned, setShowCanned] = useState(false);
  const [showOnsiteForm, setShowOnsiteForm] = useState(false);
  const [onsiteForm, setOnsiteForm] = useState({ type: 'visit_employee', scheduledAt: '', roomInfo: '', notes: '' });

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['ticket', id],
    queryFn: async () => (await api.get(`/tickets/${id}`)).data.data,
    enabled: !!id,
  });

  const { data: staffList } = useQuery({
    queryKey: ['staff-list'],
    queryFn: async () => (await api.get('/staff')).data.data,
  });

  const { data: cannedResponses } = useQuery({
    queryKey: ['canned-responses'],
    queryFn: async () => (await api.get('/templates/canned')).data.data,
  });

  const handleStatusChange = async (status: string) => {
    try {
      await api.put(`/tickets/${id}`, { status });
      queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      toast.success('Durum güncellendi');
    } catch {
      toast.error('Güncelleme başarısız');
    }
  };

  const handlePriorityChange = async (priority: string) => {
    try {
      await api.put(`/tickets/${id}`, { priority });
      queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      toast.success('Öncelik güncellendi');
    } catch {
      toast.error('Güncelleme başarısız');
    }
  };

  const handleAssign = async (assignedToId: string | null) => {
    try {
      await api.put(`/tickets/${id}`, { assignedToId });
      queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      toast.success('Atama güncellendi');
    } catch {
      toast.error('Atama başarısız');
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
      toast.success(isInternal ? 'Dahili not eklendi' : 'Not eklendi');
    } catch {
      toast.error('Not eklenemedi');
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
      toast.success('Dosya yüklendi');
    } catch {
      toast.error('Dosya yüklenemedi');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  if (isLoading || !ticket) {
    return <div className="text-center py-12 text-gray-400">Yükleniyor...</div>;
  }

  // Merge notes and history into timeline
  const timeline = [
    ...(ticket.history || []).map((h: any) => ({ ...h, _type: 'history', _time: h.createdAt })),
    ...(ticket.notes || []).map((n: any) => ({ ...n, _type: 'note', _time: n.createdAt })),
  ].sort((a, b) => new Date(a._time).getTime() - new Date(b._time).getTime());

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/staff/tickets" className="p-2 hover:bg-gray-200 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-primary-600">{ticket.ticketNumber}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[ticket.status]}`}>
              {STATUS_LABELS[ticket.status]}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[ticket.priority]}`}>
              {PRIORITY_LABELS[ticket.priority]}
            </span>
          </div>
          <h1 className="text-xl font-bold mt-1">{ticket.subject}</h1>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main content - 2 cols */}
        <div className="lg:col-span-2 space-y-6">
          {/* Description */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-500 mb-2">Açıklama</h3>
            <p className="text-gray-800 whitespace-pre-wrap">{ticket.description}</p>
          </div>

          {/* Custom fields */}
          {ticket.customValues?.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-semibold text-gray-500 mb-3">Ek Bilgiler</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {ticket.customValues.map((cv: any) => (
                  <div key={cv.id} className="bg-gray-50 rounded-lg p-3">
                    <span className="text-gray-500 text-xs">{cv.customField.fieldLabel}</span>
                    <p className="font-medium mt-0.5">{cv.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Attachments */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-500 flex items-center gap-2">
                <Paperclip className="w-4 h-4" /> Dosyalar
                {ticket.attachments?.length > 0 && (
                  <span className="bg-gray-200 text-gray-600 text-xs px-1.5 rounded-full">{ticket.attachments.length}</span>
                )}
              </h3>
              <label className={`btn-secondary text-xs flex items-center gap-1 cursor-pointer ${uploading ? 'opacity-50' : ''}`}>
                <Upload className="w-3 h-3" />
                {uploading ? 'Yükleniyor...' : 'Dosya Ekle'}
                <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploading} />
              </label>
            </div>
            {ticket.attachments?.length > 0 ? (
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
            ) : (
              <p className="text-sm text-gray-400">Henüz dosya eklenmemiş</p>
            )}
          </div>

          {/* Timeline */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-500 mb-4">Zaman Çizelgesi</h3>
            <div className="space-y-4">
              {timeline.map((item: any, i: number) => {
                if (item._type === 'note') {
                  return (
                    <div key={`note-${item.id}`} className={`rounded-lg p-4 ${item.isInternal ? 'bg-yellow-50 border border-yellow-200' : 'bg-primary-50 border border-primary-200'}`}>
                      <div className="flex items-center gap-2 mb-2">
                        {item.isInternal ? (
                          <Lock className="w-4 h-4 text-yellow-600" />
                        ) : (
                          <MessageSquare className="w-4 h-4 text-primary-600" />
                        )}
                        <span className="font-medium text-sm">
                          {item.createdBy?.fullName}
                        </span>
                        {item.isInternal && (
                          <span className="text-xs bg-yellow-200 text-yellow-700 px-1.5 py-0.5 rounded">
                            Dahili Not
                          </span>
                        )}
                        <span className="text-xs text-gray-400 ml-auto">
                          {new Date(item.createdAt).toLocaleString('tr-TR')}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700">{item.content}</p>
                    </div>
                  );
                }

                // History entry
                return (
                  <div key={`hist-${item.id}`} className="flex gap-3 text-sm text-gray-500">
                    <div className="w-2 h-2 rounded-full bg-gray-300 mt-1.5 flex-shrink-0" />
                    <div className="flex-1">
                      <span className="text-xs text-gray-400">
                        {new Date(item.createdAt).toLocaleString('tr-TR')}
                      </span>
                      {item.createdBy && <span className="text-xs ml-2">({item.createdBy.fullName})</span>}
                      <span className="ml-2">
                        {item.action === 'ticket_created' && 'Talep oluşturuldu'}
                        {item.action === 'status_changed' && `Durum: ${STATUS_LABELS[item.oldValue] || item.oldValue} → ${STATUS_LABELS[item.newValue] || item.newValue}`}
                        {item.action === 'priority_changed' && `Öncelik: ${item.oldValue} → ${item.newValue}`}
                        {item.action === 'assigned' && 'Talep atandı'}
                        {item.action === 'user_reply' && `Kullanıcı yanıtı: ${item.newValue}`}
                        {item.action === 'onsite_scheduled' && 'Yerinde destek planlandı'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add note form */}
            <form onSubmit={handleAddNote} className="mt-6 pt-4 border-t space-y-3">
              {/* Canned response picker */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowCanned(!showCanned)}
                  className="text-xs text-primary-600 hover:underline mb-2"
                >
                  Hazır Yanıtlar {showCanned ? '▲' : '▼'}
                </button>
                {showCanned && cannedResponses && (
                  <div className="absolute z-10 bg-white border rounded-lg shadow-lg p-2 w-full max-h-48 overflow-y-auto">
                    {cannedResponses.map((cr: any) => (
                      <button
                        key={cr.id}
                        type="button"
                        onClick={() => { setNoteContent(cr.content); setShowCanned(false); }}
                        className="w-full text-left p-2 hover:bg-gray-50 rounded text-sm"
                      >
                        <span className="font-medium">{cr.title}</span>
                        {cr.category && <span className="text-xs text-gray-400 ml-2">[{cr.category}]</span>}
                        <p className="text-xs text-gray-500 truncate">{cr.content}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-4 mb-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    checked={!isInternal}
                    onChange={() => setIsInternal(false)}
                    className="text-primary-600"
                  />
                  <MessageSquare className="w-4 h-4" /> Public Not
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    checked={isInternal}
                    onChange={() => setIsInternal(true)}
                    className="text-yellow-600"
                  />
                  <Lock className="w-4 h-4" /> Dahili Not
                </label>
              </div>
              <textarea
                className={`input-field min-h-[80px] ${isInternal ? 'border-yellow-300 bg-yellow-50' : ''}`}
                value={noteContent}
                onChange={e => setNoteContent(e.target.value)}
                placeholder={isInternal ? 'Sadece IT ekibinin göreceği not...' : 'Not ekle...'}
              />
              <button type="submit" disabled={sending || !noteContent.trim()} className="btn-primary flex items-center gap-2">
                <Send className="w-4 h-4" />
                {sending ? 'Gönderiliyor...' : 'Not Ekle'}
              </button>
            </form>
          </div>
        </div>

        {/* Sidebar - 1 col */}
        <div className="space-y-4">
          {/* Ticket info */}
          <div className="card space-y-4">
            <h3 className="font-semibold text-sm text-gray-500">Talep Bilgileri</h3>

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
                <span>{new Date(ticket.createdAt).toLocaleString('tr-TR')}</span>
              </div>
            </div>

            <hr />

            {/* Created by */}
            <div>
              <span className="text-xs text-gray-500 block mb-1">Oluşturan</span>
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
            <h3 className="font-semibold text-sm text-gray-500">İşlemler</h3>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Durum</label>
              <select
                className="input-field text-sm"
                value={ticket.status}
                onChange={e => handleStatusChange(e.target.value)}
              >
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Öncelik</label>
              <select
                className="input-field text-sm"
                value={ticket.priority}
                onChange={e => handlePriorityChange(e.target.value)}
              >
                {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Atanan Kişi</label>
              <select
                className="input-field text-sm"
                value={ticket.assignedToId || ''}
                onChange={e => handleAssign(e.target.value || null)}
              >
                <option value="">Atanmamış</option>
                {staffList?.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.fullName}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Onsite support */}
          <div className="card space-y-3">
            <h3 className="font-semibold text-sm text-gray-500 flex items-center gap-2">
              <MapPin className="w-4 h-4" /> Yerinde Destek
            </h3>

            {ticket.onsiteSupport?.length > 0 && (
              <div className="space-y-2 text-xs">
                {ticket.onsiteSupport.map((os: any) => (
                  <div key={os.id} className="bg-orange-50 rounded p-2">
                    <div className="font-medium">{os.type === 'come_to_it_room' ? 'IT Odasına Gelin' : 'Yerinde Müdahale'}</div>
                    <div className="text-gray-500">{new Date(os.scheduledAt).toLocaleString('tr-TR')}</div>
                    <div className="text-gray-500">{os.location?.name}</div>
                  </div>
                ))}
              </div>
            )}

            {!showOnsiteForm ? (
              <button onClick={() => setShowOnsiteForm(true)} className="btn-secondary text-xs w-full">
                Randevu Oluştur
              </button>
            ) : (
              <div className="space-y-2">
                <select
                  className="input-field text-sm"
                  value={onsiteForm.type}
                  onChange={e => setOnsiteForm({ ...onsiteForm, type: e.target.value })}
                >
                  <option value="visit_employee">Yerinde Müdahale</option>
                  <option value="come_to_it_room">IT Odasına Gelin</option>
                </select>
                <input
                  type="datetime-local"
                  className="input-field text-sm"
                  value={onsiteForm.scheduledAt}
                  onChange={e => setOnsiteForm({ ...onsiteForm, scheduledAt: e.target.value })}
                />
                {onsiteForm.type === 'come_to_it_room' && (
                  <input
                    type="text"
                    className="input-field text-sm"
                    placeholder="Oda bilgisi"
                    value={onsiteForm.roomInfo}
                    onChange={e => setOnsiteForm({ ...onsiteForm, roomInfo: e.target.value })}
                  />
                )}
                <textarea
                  className="input-field text-sm"
                  placeholder="Not..."
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
                          roomInfo: onsiteForm.roomInfo || undefined,
                          notes: onsiteForm.notes || undefined,
                        });
                        queryClient.invalidateQueries({ queryKey: ['ticket', id] });
                        setShowOnsiteForm(false);
                        setOnsiteForm({ type: 'visit_employee', scheduledAt: '', roomInfo: '', notes: '' });
                        toast.success('Randevu oluşturuldu');
                      } catch {
                        toast.error('Randevu oluşturulamadı');
                      }
                    }}
                    disabled={!onsiteForm.scheduledAt}
                  >
                    Oluştur
                  </button>
                  <button className="btn-secondary text-xs flex-1" onClick={() => setShowOnsiteForm(false)}>
                    İptal
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* SLA info */}
          {(ticket.slaResponseDue || ticket.slaResolveDue) && (
            <div className="card space-y-2 text-sm">
              <h3 className="font-semibold text-sm text-gray-500">SLA</h3>
              {ticket.slaResponseDue && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Yanıt Süresi:</span>
                  <span className={ticket.slaResponseMet === false ? 'text-red-600 font-medium' : ''}>
                    {new Date(ticket.slaResponseDue).toLocaleString('tr-TR')}
                  </span>
                </div>
              )}
              {ticket.slaResolveDue && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Çözüm Süresi:</span>
                  <span className={ticket.slaResolveMet === false ? 'text-red-600 font-medium' : ''}>
                    {new Date(ticket.slaResolveDue).toLocaleString('tr-TR')}
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
