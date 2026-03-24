import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Calendar, MapPin, Clock, User, CheckCircle2, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';

const TYPE_LABELS: Record<string, string> = {
  visit_employee: 'Yerinde Müdahale',
  come_to_it_room: 'IT Odasına Gelin',
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Planlandı',
  in_progress: 'Devam Ediyor',
  completed: 'Tamamlandı',
  cancelled: 'İptal',
};

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function OnsiteSupportPage() {
  const queryClient = useQueryClient();
  const [weekOffset, setWeekOffset] = useState(0);

  const startOfWeek = new Date();
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay() + 1 + weekOffset * 7);
  startOfWeek.setHours(0, 0, 0, 0);

  const { data } = useQuery({
    queryKey: ['onsite-calendar', weekOffset],
    queryFn: async () => (await api.get(`/onsite-support/calendar?week=${startOfWeek.toISOString()}`)).data.data,
  });

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(d.getDate() + i);
    return d;
  });

  const dayNames = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

  const handleStatusUpdate = async (id: string, status: string) => {
    try {
      await api.put(`/onsite-support/${id}`, { status });
      queryClient.invalidateQueries({ queryKey: ['onsite-calendar'] });
      toast.success('Durum güncellendi');
    } catch {
      toast.error('Güncelleme başarısız');
    }
  };

  const getEventsForDay = (day: Date) => {
    if (!data?.events) return [];
    return data.events.filter((e: any) => {
      const eventDate = new Date(e.scheduledAt);
      return eventDate.toDateString() === day.toDateString();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Yerinde Destek Takvimi</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekOffset(w => w - 1)} className="btn-secondary text-sm">← Önceki</button>
          <button onClick={() => setWeekOffset(0)} className="btn-secondary text-sm">Bu Hafta</button>
          <button onClick={() => setWeekOffset(w => w + 1)} className="btn-secondary text-sm">Sonraki →</button>
        </div>
      </div>

      {/* Week grid */}
      <div className="grid grid-cols-7 gap-2">
        {days.map((day, i) => {
          const events = getEventsForDay(day);
          const isToday = day.toDateString() === new Date().toDateString();

          return (
            <div key={i} className={`card p-3 min-h-[200px] ${isToday ? 'ring-2 ring-primary-400' : ''}`}>
              <div className="text-center mb-2">
                <div className="text-xs text-gray-400">{dayNames[i]}</div>
                <div className={`text-lg font-bold ${isToday ? 'text-primary-600' : ''}`}>
                  {day.getDate()}
                </div>
              </div>

              <div className="space-y-2">
                {events.map((event: any) => (
                  <div key={event.id} className="bg-gray-50 rounded-lg p-2 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLORS[event.status] || ''}`}>
                        {TYPE_LABELS[event.type]}
                      </span>
                      <span className="text-gray-400">
                        {new Date(event.scheduledAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="font-medium truncate">{event.ticket?.subject}</div>
                    <div className="text-gray-500 flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {event.ticket?.createdBy?.fullName}
                    </div>
                    <div className="text-gray-500 flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {event.location?.name}
                    </div>

                    {event.status === 'scheduled' && (
                      <div className="flex gap-1 pt-1">
                        <button
                          onClick={() => handleStatusUpdate(event.id, 'in_progress')}
                          className="flex-1 bg-yellow-100 text-yellow-700 py-0.5 rounded text-[10px] hover:bg-yellow-200"
                        >
                          Başla
                        </button>
                        <button
                          onClick={() => handleStatusUpdate(event.id, 'cancelled')}
                          className="flex-1 bg-red-100 text-red-700 py-0.5 rounded text-[10px] hover:bg-red-200"
                        >
                          İptal
                        </button>
                      </div>
                    )}
                    {event.status === 'in_progress' && (
                      <button
                        onClick={() => handleStatusUpdate(event.id, 'completed')}
                        className="w-full bg-green-100 text-green-700 py-0.5 rounded text-[10px] hover:bg-green-200"
                      >
                        Tamamla
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Upcoming list */}
      <div className="card">
        <h3 className="font-semibold mb-3">Bu Haftanın Randevuları</h3>
        {data?.events?.length > 0 ? (
          <div className="space-y-2">
            {data.events.map((event: any) => (
              <div key={event.id} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg text-sm">
                <div className="flex-shrink-0">
                  <Calendar className="w-5 h-5 text-gray-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{event.ticket?.ticketNumber} — {event.ticket?.subject}</div>
                  <div className="text-gray-500 text-xs">
                    {event.ticket?.createdBy?.fullName} • {event.location?.name} •
                    {new Date(event.scheduledAt).toLocaleString('tr-TR')}
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[event.status]}`}>
                  {STATUS_LABELS[event.status]}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-400 text-sm">Bu hafta randevu yok.</p>
        )}
      </div>
    </div>
  );
}
