import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../src/pages/staff/onsite-calendar';
import {
  computeLayout,
  eventDurationMin,
  mondayOf,
  sameDay,
  toInputDate,
} from '../src/pages/staff/onsite-calendar';

function appointment(
  id: string,
  scheduledAt: string,
  scheduledEnd?: string,
): CalendarEvent {
  return {
    id,
    ticketId: `ticket-${id}`,
    locationId: 'location-1',
    type: 'visit_employee',
    scheduledAt,
    scheduledEnd,
    status: 'scheduled',
    createdAt: scheduledAt,
  };
}

describe('saha destek takvim yerleşimi', () => {
  it('örtüşen randevuları ayrı kolonlara yerleştirir', () => {
    const first = appointment('first', '2026-07-16T09:00:00Z', '2026-07-16T10:00:00Z');
    const second = appointment('second', '2026-07-16T09:30:00Z', '2026-07-16T10:30:00Z');

    expect(computeLayout([second, first])).toEqual([
      { event: first, col: 0, cols: 2 },
      { event: second, col: 1, cols: 2 },
    ]);
  });

  it('önceki randevu bittiğinde aynı kolonu yeniden kullanır', () => {
    const first = appointment('first', '2026-07-16T09:00:00Z', '2026-07-16T10:00:00Z');
    const second = appointment('second', '2026-07-16T10:00:00Z', '2026-07-16T10:30:00Z');

    expect(computeLayout([first, second])).toEqual([
      { event: first, col: 0, cols: 1 },
      { event: second, col: 0, cols: 1 },
    ]);
  });

  it('eksik veya geçersiz bitiş zamanında güvenli varsayılan süreyi kullanır', () => {
    const missing = appointment('missing', '2026-07-16T09:00:00Z');
    const reversed = appointment('reversed', '2026-07-16T10:00:00Z', '2026-07-16T09:00:00Z');

    expect(eventDurationMin(missing)).toBe(15);
    expect(eventDurationMin(reversed, 30)).toBe(30);
  });
});

describe('takvim tarih yardımcıları', () => {
  it('pazar gününü aynı haftanın pazartesisine taşır', () => {
    const monday = mondayOf(new Date(2026, 6, 19, 14, 30));

    expect(toInputDate(monday)).toBe('2026-07-13');
    expect(sameDay(monday, new Date(2026, 6, 13, 23, 59))).toBe(true);
  });
});
