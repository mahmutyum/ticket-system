import { describe, it, expect } from 'vitest';
import {
  addBusinessMinutes,
  businessMinutesBetween,
  hasWorkingTime,
  isValidTimezone,
  type BusinessCalendar,
} from '../../src/utils/business-hours.js';

/**
 * Mesai takvimi hesapları. İstanbul UTC+3'tür (DST yok); DST davranışı Berlin
 * ile doğrulanır. 2026-07-17 bir Cuma'dır.
 */

const nineToSix = [{ start: '09:00', end: '18:00' }];
const IST: BusinessCalendar = {
  timezone: 'Europe/Istanbul',
  week: { mon: nineToSix, tue: nineToSix, wed: nineToSix, thu: nineToSix, fri: nineToSix },
  holidays: [],
};

describe('addBusinessMinutes', () => {
  it('mesai içinde düz ekler', () => {
    // Cuma 10:00 İstanbul = 07:00Z; +60 dk → 11:00 yerel
    const r = addBusinessMinutes(new Date('2026-07-17T07:00:00Z'), 60, IST);
    expect(r).toEqual(new Date('2026-07-17T08:00:00Z'));
  });

  it('Cuma 17:55 + 4 saat → Pazartesi 12:55 (hafta sonu sayılmaz)', () => {
    const r = addBusinessMinutes(new Date('2026-07-17T14:55:00Z'), 240, IST);
    // 5 dk Cuma + 235 dk Pazartesi 09:00'dan → 12:55 yerel = 09:55Z
    expect(r).toEqual(new Date('2026-07-20T09:55:00Z'));
  });

  it('mesai dışında başlarsa bir sonraki aralığın başından sayar', () => {
    // Cumartesi 12:00 yerel → Pazartesi 09:00 + 30 dk
    const r = addBusinessMinutes(new Date('2026-07-18T09:00:00Z'), 30, IST);
    expect(r).toEqual(new Date('2026-07-20T06:30:00Z'));
  });

  it('tatil günlerini atlar', () => {
    const cal = { ...IST, holidays: ['2026-07-20'] };
    const r = addBusinessMinutes(new Date('2026-07-17T14:55:00Z'), 240, cal);
    expect(r).toEqual(new Date('2026-07-21T09:55:00Z'));
  });

  it('öğle arası gibi bölünmüş aralıkları destekler', () => {
    const split = [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '18:00' }];
    const cal: BusinessCalendar = { ...IST, week: { fri: split, mon: split } };
    // Cuma 11:30 + 60 dk → 30 dk öğleden önce + 30 dk 13:00'ten → 13:30
    const r = addBusinessMinutes(new Date('2026-07-17T08:30:00Z'), 60, cal);
    expect(r).toEqual(new Date('2026-07-17T10:30:00Z'));
  });

  it('yaz saati geçişinde yerel saati korur (Berlin, 29 Mart 2026)', () => {
    const cal: BusinessCalendar = { timezone: 'Europe/Berlin', week: { fri: nineToSix, mon: nineToSix }, holidays: [] };
    // Cuma 27 Mart 17:00 CET (16:00Z) + 120 dk → 60 dk Cuma + Pazartesi 10:00 CEST (08:00Z)
    const r = addBusinessMinutes(new Date('2026-03-27T16:00:00Z'), 120, cal);
    expect(r).toEqual(new Date('2026-03-30T08:00:00Z'));
  });

  it('hiç çalışma zamanı yoksa düz dakika ekler (sonsuz döngü yok)', () => {
    const cal: BusinessCalendar = { ...IST, week: {} };
    expect(hasWorkingTime(cal)).toBe(false);
    const r = addBusinessMinutes(new Date('2026-07-17T07:00:00Z'), 60, cal);
    expect(r).toEqual(new Date('2026-07-17T08:00:00Z'));
  });
});

describe('businessMinutesBetween', () => {
  it('hafta sonunu saymaz', () => {
    // Cuma 17:00 → Pazartesi 10:00 yerel = 60 + 60
    expect(businessMinutesBetween(new Date('2026-07-17T14:00:00Z'), new Date('2026-07-20T07:00:00Z'), IST)).toBe(120);
  });

  it('addBusinessMinutes ile tutarlıdır', () => {
    const start = new Date('2026-07-16T13:17:00Z');
    const end = addBusinessMinutes(start, 1234, IST);
    expect(businessMinutesBetween(start, end, IST)).toBe(1234);
  });

  it('ters aralık → 0', () => {
    expect(businessMinutesBetween(new Date('2026-07-17T10:00:00Z'), new Date('2026-07-17T09:00:00Z'), IST)).toBe(0);
  });
});

describe('isValidTimezone', () => {
  it('IANA adlarını kabul eder, uydurmayı reddeder', () => {
    expect(isValidTimezone('Europe/Istanbul')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
  });
});
