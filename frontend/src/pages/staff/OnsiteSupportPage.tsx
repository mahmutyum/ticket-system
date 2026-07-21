import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { MapPin, User, ChevronLeft, ChevronRight, CalendarDays, X, Clock, Hash } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { dateLocale } from '../../i18n/format';
import api from '../../api/client';
import {
  computeLayout, eventDurationMin, HOUR_HEIGHT, mondayOf, sameDay,
  startOfDay, STATUS_COLORS, TIMELINE_START_HOUR,
  toInputDate, TOTAL_HOURS, TYPE_BAR_COLORS,
  type CalendarEvent, type CalendarResponse,
} from './onsite-calendar';
import { PageHeader } from '../../components/ui/PageHeader';
import { useEnumLabels } from '../../i18n/labels';

export default function OnsiteSupportPage() {
  const { t, i18n } = useTranslation();
  const labels = useEnumLabels();
  const locale = i18n.language.startsWith('tr') ? dateLocale() : 'en-US';
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState<Date>(() => startOfDay(new Date()));
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [companyFilter, setCompanyFilter] = useState('');

  const weekStart = useMemo(() => mondayOf(selectedDate), [selectedDate]);

  const { data } = useQuery<CalendarResponse>({
    queryKey: ['onsite-calendar', weekStart.toISOString(), companyFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ week: weekStart.toISOString() });
      if (companyFilter) params.set('companyId', companyFilter);
      return (await api.get(`/onsite-support/calendar?${params}`)).data.data;
    },
  });

  const { data: companies } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['companies-scoped'],
    queryFn: async () => {
      const rows = (await api.get('/companies/admin/all')).data.data as Array<{ id: string; name: string }>;
      return rows.map(({ id, name }) => ({ id, name }));
    },
  });

  const weekDays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        return d;
      }),
    [weekStart],
  );

  const handleStatusUpdate = async (id: string, status: string) => {
    try {
      await api.put(`/onsite-support/${id}`, { status });
      queryClient.invalidateQueries({ queryKey: ['onsite-calendar'] });
      toast.success(t('onsite.toast.statusUpdated'));
      setSelectedEvent(null);
    } catch {
      toast.error(t('onsite.toast.updateFailed'));
    }
  };

  const eventsForDay = useCallback((day: Date) => {
    if (!data?.events) return [];
    return data.events
      .filter((e) => sameDay(new Date(e.scheduledAt), day))
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  }, [data?.events]);

  const selectedDayEvents = useMemo(() => eventsForDay(selectedDate), [eventsForDay, selectedDate]);

  // Interval-overlap lane atama (15 dk varsayılan süre)
  const layout = useMemo(() => computeLayout(selectedDayEvents), [selectedDayEvents]);

  const goToday = () => setSelectedDate(startOfDay(new Date()));
  const goPrevDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    setSelectedDate(d);
  };
  const goNextDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    setSelectedDate(d);
  };

  const isToday = sameDay(selectedDate, new Date());
  const longDateLabel = selectedDate.toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="space-y-4">
      {/* Üst başlık + tarih kontrolleri */}
      <PageHeader eyebrow={t('onsite.eyebrow')} title={t('onsite.title')} description={t('onsite.description', { date: longDateLabel })} actions={
        <div className="flex items-center gap-2 flex-wrap">
          <select
            className="input-field !w-auto !py-1.5 text-sm"
            value={companyFilter}
            onChange={(event) => setCompanyFilter(event.target.value)}
            aria-label={t('onsite.filterByCompany')}
          >
            <option value="">{t('onsite.allCompanies')}</option>
            {(companies || []).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
          </select>
          <div className="flex items-center gap-1">
            <button
              onClick={goPrevDay}
              className="btn-secondary text-sm !px-2"
              title={t('onsite.prevDay')}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={goToday}
              className={`btn-secondary text-sm ${isToday ? 'ring-1 ring-primary-400' : ''}`}
            >
              {t('common.today')}
            </button>
            <button
              onClick={goNextDay}
              className="btn-secondary text-sm !px-2"
              title={t('onsite.nextDay')}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <label className="relative">
            <input
              type="date"
              value={toInputDate(selectedDate)}
              onChange={(e) => {
                if (!e.target.value) return;
                const [y, m, d] = e.target.value.split('-').map(Number);
                setSelectedDate(new Date(y, m - 1, d));
              }}
              className="input-field !py-1.5 !pl-8 text-sm"
            />
            <CalendarDays className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </label>
        </div>
      } />

      {/* Hafta şeridi — kompakt, doluluk rozetli */}
      <div className="card !p-3">
        <div className="grid grid-cols-7 gap-2">
          {weekDays.map((day, i) => {
            const events = eventsForDay(day);
            const active = events.filter((e) => e.status !== 'cancelled');
            const count = active.length;
            const selected = sameDay(day, selectedDate);
            const today = sameDay(day, new Date());

            return (
              <button
                key={i}
                onClick={() => setSelectedDate(startOfDay(day))}
                className={`relative rounded-control p-2 text-center transition-[color,background-color,border-color,box-shadow] border ${
                  selected
                    ? 'bg-primary-600 text-white border-primary-600 shadow-surface'
                    : today
                    ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 dark:border-primary-700'
                    : 'border-gray-200 hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800/50'
                }`}
              >
                <div className={`text-[10px] uppercase tracking-wide ${selected ? 'text-white/80' : 'text-muted'}`}>
                  {day.toLocaleDateString(locale, { weekday: 'short' })}
                </div>
                <div className="text-lg font-bold leading-tight">{day.getDate()}</div>
                <div className="flex items-center justify-center gap-1 mt-1 min-h-[18px]">
                  {count > 0 && (
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                        selected
                          ? 'bg-white/20 text-white'
                          : count >= 5
                          ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200'
                          : count >= 3
                          ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-200'
                          : 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200'
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Günlük timeline — gece vardiyaları dahil tam 24 saat */}
      <div className="card p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-slate-800">
          <h3 className="font-semibold">
            {selectedDate.toLocaleDateString(locale, { day: 'numeric', month: 'long' })} —{' '}
            <span className="text-muted font-normal">
              {t('onsite.activeCount', { count: selectedDayEvents.filter((e) => e.status !== 'cancelled').length })}
            </span>
          </h3>
        </div>

        {selectedDayEvents.length === 0 ? (
          <div className="px-4 py-12 text-center text-muted text-sm">
            {t('onsite.noAppointments')}
          </div>
        ) : (
          <div className="relative flex">
            {/* Saat sütunu */}
            <div className="w-16 flex-shrink-0 border-r border-gray-200 dark:border-slate-800">
              {Array.from({ length: TOTAL_HOURS }, (_, i) => {
                const hour = TIMELINE_START_HOUR + i;
                return (
                  <div
                    key={hour}
                    className="text-xs text-muted text-right pr-2 pt-1"
                    style={{ height: HOUR_HEIGHT }}
                  >
                    {String(hour).padStart(2, '0')}:00
                  </div>
                );
              })}
            </div>

            {/* Etkinlik alanı */}
            <div className="relative flex-1" style={{ height: TOTAL_HOURS * HOUR_HEIGHT }}>
              {/* Saat ızgarası */}
              {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                <div
                  key={i}
                  className="absolute left-0 right-0 border-t border-gray-100 dark:border-slate-800"
                  style={{ top: i * HOUR_HEIGHT }}
                />
              ))}

              {/* Şu anki saat çizgisi (sadece bugün için) */}
              {isToday &&
                (() => {
                  const now = new Date();
                  const minutes = (now.getHours() - TIMELINE_START_HOUR) * 60 + now.getMinutes();
                  if (minutes < 0 || minutes > TOTAL_HOURS * 60) return null;
                  const top = (minutes / 60) * HOUR_HEIGHT;
                  return (
                    <div
                      className="absolute left-0 right-0 z-10 pointer-events-none"
                      style={{ top }}
                    >
                      <div className="h-px bg-red-500" />
                      <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-red-500" />
                    </div>
                  );
                })()}

              {/* Etkinlikler */}
              {layout.map(({ event, col, cols }) => {
                const start = new Date(event.scheduledAt);
                const minutesFromStart =
                  (start.getHours() - TIMELINE_START_HOUR) * 60 + start.getMinutes();
                if (minutesFromStart < 0 || minutesFromStart > TOTAL_HOURS * 60) return null;
                const top = (minutesFromStart / 60) * HOUR_HEIGHT;
                const widthPct = 100 / cols;
                const leftPct = col * widthPct;
                const cancelled = event.status === 'cancelled';
                const durationMin = eventDurationMin(event);
                const height = Math.max((durationMin / 60) * HOUR_HEIGHT, 28);
                // Kart yüksekliğine göre kademeli içerik: kısa kart yalnızca saat + konu;
                // tüm detay tıklanınca açılan popup'ta gösterilir.
                const compact = height < 52;
                return (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => setSelectedEvent(event)}
                    title={t('onsite.viewDetails')}
                    className={`absolute rounded-control px-2 py-1 text-xs overflow-hidden border shadow-surface text-left transition-[color,background-color,border-color,box-shadow] hover:shadow-raised hover:ring-1 hover:ring-primary-400 hover:z-20 ${
                      cancelled
                        ? 'bg-gray-50 dark:bg-slate-800/40 border-gray-200 dark:border-slate-700 opacity-60'
                        : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700'
                    }`}
                    style={{
                      top,
                      left: `calc(${leftPct}% + 4px)`,
                      width: `calc(${widthPct}% - 8px)`,
                      height: height - 4,
                      zIndex: 2,
                    }}
                  >
                    <div className="flex gap-1.5 h-full">
                      <div
                        className={`w-1 rounded-full flex-shrink-0 ${
                          TYPE_BAR_COLORS[event.type] || 'bg-gray-400'
                        } ${cancelled ? 'opacity-40' : ''}`}
                      />
                      <div className="flex-1 min-w-0 leading-tight">
                        {compact ? (
                          <div className="flex items-baseline gap-1 truncate">
                            <span className="font-semibold text-[11px] flex-shrink-0">
                              {start.toLocaleTimeString(locale, {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            <span className="truncate text-[11px]">{event.ticket?.subject}</span>
                          </div>
                        ) : (
                          <div className="space-y-0.5">
                            <span className="font-semibold text-[11px]">
                              {start.toLocaleTimeString(locale, {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            <div className="font-medium truncate">{event.ticket?.subject}</div>
                            <div className="text-muted truncate flex items-center gap-1">
                              <User className="w-3 h-3 flex-shrink-0" />
                              <span className="truncate">{event.ticket?.createdBy?.fullName}</span>
                            </div>
                            {height >= 76 && (
                              <div className="text-muted truncate flex items-center gap-1">
                                <MapPin className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate">{event.location?.name}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Seçilen günün liste özeti */}
      {selectedDayEvents.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-3">{t('onsite.listView')}</h3>
          <div className="space-y-2">
            {selectedDayEvents.map((event) => (
              <button
                key={event.id}
                type="button"
                onClick={() => setSelectedEvent(event)}
                className="w-full text-left flex items-center gap-4 p-3 bg-gray-50 dark:bg-slate-800/50 rounded-inset text-sm transition-colors hover:bg-gray-100 dark:hover:bg-slate-800"
              >
                <div
                  className={`w-1 h-10 rounded-full ${
                    TYPE_BAR_COLORS[event.type] || 'bg-gray-400'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {event.ticket?.ticketNumber} — {event.ticket?.subject}
                  </div>
                  <div className="text-muted text-xs">
                    {event.ticket?.createdBy?.fullName} • {event.location?.name} •{' '}
                    {new Date(event.scheduledAt).toLocaleTimeString(locale, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    STATUS_COLORS[event.status]
                  }`}
                >
                  {labels.onsiteStatus(event.status)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Randevu detay popup'ı */}
      {selectedEvent &&
        (() => {
          const ev = selectedEvent;
          const start = new Date(ev.scheduledAt);
          const durationMin = eventDurationMin(ev);
          const end = new Date(start.getTime() + durationMin * 60000);
          const fmt = (d: Date) =>
            d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
              onClick={() => setSelectedEvent(null)}
            >
              <div
                className="card w-full max-w-md !p-0 overflow-hidden shadow-overlay"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-200 dark:border-slate-800">
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={`w-1.5 self-stretch rounded-full flex-shrink-0 ${
                        TYPE_BAR_COLORS[ev.type] || 'bg-gray-400'
                      }`}
                    />
                    <div className="min-w-0">
                      <h3 className="font-semibold break-words">{ev.ticket?.subject}</h3>
                      <span
                        className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          STATUS_COLORS[ev.status] || ''
                        }`}
                      >
                        {labels.onsiteStatus(ev.status)}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedEvent(null)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 flex-shrink-0"
                    title={t('common.close')}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="px-5 py-4 space-y-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted flex-shrink-0" />
                    <span>
                      {fmt(start)} – {fmt(end)}{' '}
                      <span className="text-muted">({t('onsite.durationMin', { count: durationMin })})</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CalendarDays className="w-4 h-4 text-muted flex-shrink-0" />
                    <span className="capitalize">
                      {start.toLocaleDateString(locale, {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                      })}{' '}
                      · {t(`onsite.type.${ev.type}`, { defaultValue: ev.type })}
                    </span>
                  </div>
                  {ev.ticket?.ticketNumber && (
                    <div className="flex items-center gap-2">
                      <Hash className="w-4 h-4 text-muted flex-shrink-0" />
                      <span>{ev.ticket.ticketNumber}</span>
                    </div>
                  )}
                  {ev.ticket?.createdBy?.fullName && (
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-muted flex-shrink-0" />
                      <span>{ev.ticket.createdBy.fullName}</span>
                    </div>
                  )}
                  {ev.location?.name && (
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-muted flex-shrink-0" />
                      <span>{ev.location.name}</span>
                    </div>
                  )}
                </div>

                {(ev.status === 'scheduled' || ev.status === 'in_progress') && (
                  <div className="flex gap-2 px-5 py-4 border-t border-gray-200 dark:border-slate-800">
                    {ev.status === 'scheduled' && (
                      <>
                        <button
                          onClick={() => handleStatusUpdate(ev.id, 'in_progress')}
                          className="flex-1 bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-200 py-2 rounded-control text-sm font-medium hover:bg-yellow-200 dark:hover:bg-yellow-500/30"
                        >
                          {t('onsite.actions.start')}
                        </button>
                        <button
                          onClick={() => handleStatusUpdate(ev.id, 'cancelled')}
                          className="flex-1 bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200 py-2 rounded-control text-sm font-medium hover:bg-red-200 dark:hover:bg-red-500/30"
                        >
                          {t('common.cancel')}
                        </button>
                      </>
                    )}
                    {ev.status === 'in_progress' && (
                      <button
                        onClick={() => handleStatusUpdate(ev.id, 'completed')}
                        className="flex-1 bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-200 py-2 rounded-control text-sm font-medium hover:bg-green-200 dark:hover:bg-green-500/30"
                      >
                        {t('onsite.actions.complete')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
    </div>
  );
}
