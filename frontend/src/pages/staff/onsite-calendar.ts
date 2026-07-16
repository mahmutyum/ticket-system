import type { OnsiteSupport } from '../../types';

export const TYPE_LABELS: Record<string, string> = {
  come_to_it_room: 'IT Odasına Gelin', meeting_room: 'Toplantı Odası', visit_employee: 'Yerinde Müdahale',
};
export const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Planlandı', in_progress: 'Devam Ediyor', completed: 'Tamamlandı', cancelled: 'İptal',
};
export const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200',
  in_progress: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-200',
  completed: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-200',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200',
};
export const TYPE_BAR_COLORS: Record<string, string> = {
  come_to_it_room: 'bg-blue-500', meeting_room: 'bg-purple-500', visit_employee: 'bg-emerald-500',
};
export const DAY_NAMES = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
export const TIMELINE_START_HOUR = 8;
export const TIMELINE_END_HOUR = 19;
export const HOUR_HEIGHT = 80;
export const TOTAL_HOURS = TIMELINE_END_HOUR - TIMELINE_START_HOUR;
const DEFAULT_DURATION_MIN = 15;

export type CalendarEvent = OnsiteSupport & {
  ticket?: {
    ticketNumber: string; subject: string;
    createdBy?: { fullName: string; phone?: string }; createdByEmail?: string;
  };
};
export type CalendarResponse = { startDate: string; endDate: string; events: CalendarEvent[] };
export type LayoutItem = { event: CalendarEvent; col: number; cols: number };

export function eventDurationMin(event: CalendarEvent, fallback = DEFAULT_DURATION_MIN): number {
  if (!event.scheduledEnd) return fallback;
  const minutes = Math.round(
    (new Date(event.scheduledEnd).getTime() - new Date(event.scheduledAt).getTime()) / 60_000,
  );
  return minutes > 0 ? minutes : fallback;
}

export function computeLayout(events: CalendarEvent[]): LayoutItem[] {
  if (events.length === 0) return [];
  const items = events
    .map((event) => {
      const start = new Date(event.scheduledAt).getTime();
      return { event, start, end: start + eventDurationMin(event) * 60_000 };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const result: LayoutItem[] = [];
  let cluster: typeof items = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    if (cluster.length === 0) return;
    const lanes: number[] = [];
    const assignments = cluster.map((item) => {
      const available = lanes.findIndex((end) => end <= item.start);
      if (available >= 0) {
        lanes[available] = item.end;
        return available;
      }
      lanes.push(item.end);
      return lanes.length - 1;
    });
    cluster.forEach((item, index) => result.push({
      event: item.event, col: assignments[index], cols: lanes.length,
    }));
  };
  items.forEach((item) => {
    if (cluster.length === 0 || item.start < clusterEnd) {
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.end);
    } else {
      flush();
      cluster = [item];
      clusterEnd = item.end;
    }
  });
  flush();
  return result;
}

export function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function mondayOf(date: Date): Date {
  const result = startOfDay(date);
  const day = result.getDay();
  result.setDate(result.getDate() + (day === 0 ? -6 : 1 - day));
  return result;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

export function toInputDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
