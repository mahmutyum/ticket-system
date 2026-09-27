/**
 * Mesai saati / tatil takvimi hesapları.
 *
 * SLA süreleri bir takvim tanımlıysa yalnızca mesai içindeki dakikalar sayılarak
 * işler: Cuma 17:55'te açılan 4 saatlik bir talep hafta sonu ihlal sayılmamalı.
 *
 * Harici tarih kütüphanesi kullanılmaz; saat dilimi dönüşümü `Intl.DateTimeFormat`
 * ile yapılır (Node ICU verisi IANA saat dilimlerini ve DST'yi bilir). Tüm
 * fonksiyonlar SAFTIR — girdi alır, tarih/sayı döner, yan etkisi yoktur.
 */

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** "HH:MM" — 00:00–24:00 arası. `end` için "24:00" gün sonunu ifade eder. */
export interface TimeWindow {
  start: string;
  end: string;
}

export interface BusinessCalendar {
  /** IANA saat dilimi, örn. "Europe/Istanbul". */
  timezone: string;
  /** Haftanın günlerine göre çalışma aralıkları. Tanımsız/boş gün = kapalı. */
  week: Partial<Record<Weekday, TimeWindow[]>>;
  /** Kapalı günler, yerel tarih olarak "YYYY-MM-DD". */
  holidays: string[];
}

const MINUTE = 60_000;
/** Sonsuz döngü koruması: hiçbir SLA bu kadar mesai gününe yayılmaz. */
const MAX_DAYS = 3 * 366;

interface LocalDate {
  y: number;
  m: number; // 1-12
  d: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timezone, f);
  }
  return f;
}

/** Geçerli bir IANA saat dilimi mi? (Zod doğrulamasında kullanılır.) */
export function isValidTimezone(timezone: string): boolean {
  try {
    formatter(timezone);
    return true;
  } catch {
    return false;
  }
}

function zonedParts(instant: number, timezone: string) {
  const parts = formatter(timezone).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute'), s: get('second') };
}

/** Saat diliminin o andaki UTC farkı (ms). İstanbul için +3 saat. */
function offsetAt(instant: number, timezone: string): number {
  const p = zonedParts(instant, timezone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Yerel duvar saatini UTC anına çevirir (DST geçişlerinde bir kez düzeltilir). */
function zonedToUtc(date: LocalDate, minuteOfDay: number, timezone: string): number {
  const naive = Date.UTC(date.y, date.m - 1, date.d) + minuteOfDay * MINUTE;
  let result = naive - offsetAt(naive, timezone);
  const corrected = naive - offsetAt(result, timezone);
  if (corrected !== result) result = corrected;
  return result;
}

function localDateOf(instant: number, timezone: string): LocalDate {
  const p = zonedParts(instant, timezone);
  return { y: p.y, m: p.m, d: p.d };
}

function nextDate(date: LocalDate): LocalDate {
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d + 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (date: LocalDate) => `${date.y}-${pad(date.m)}-${pad(date.d)}`;

export function parseTime(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return NaN;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (m > 59 || h > 24 || (h === 24 && m !== 0)) return NaN;
  return h * 60 + m;
}

/** Bir yerel gün için çalışma aralıklarını UTC [başlangıç, bitiş) çiftleri olarak döner. */
function windowsFor(date: LocalDate, calendar: BusinessCalendar, holidays: Set<string>): Array<[number, number]> {
  if (holidays.has(isoDate(date))) return [];
  const weekday = WEEKDAYS[new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay()];
  const windows = calendar.week[weekday] ?? [];
  return windows
    .map(w => [parseTime(w.start), parseTime(w.end)] as const)
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
    .sort((a, b) => a[0] - b[0])
    .map(([s, e]) => [zonedToUtc(date, s, calendar.timezone), zonedToUtc(date, e, calendar.timezone)]);
}

/** Takvimde en az bir çalışma aralığı var mı? Yoksa SLA hiç ilerleyemez. */
export function hasWorkingTime(calendar: BusinessCalendar): boolean {
  return WEEKDAYS.some(day =>
    (calendar.week[day] ?? []).some(w => parseTime(w.end) > parseTime(w.start)),
  );
}

/**
 * `start` anından itibaren `minutes` mesai dakikası sonra gelen an.
 *
 * `start` mesai dışındaysa sayım bir sonraki çalışma aralığının başından başlar.
 * Takvimde hiç çalışma zamanı yoksa (hatalı yapılandırma) mesai dışı bir takvime
 * sonsuza dek kilitlenmemek için düz dakika eklemeye düşer.
 */
export function addBusinessMinutes(start: Date, minutes: number, calendar: BusinessCalendar): Date {
  if (minutes <= 0) return new Date(start);
  if (!hasWorkingTime(calendar)) return new Date(start.getTime() + minutes * MINUTE);

  const holidays = new Set(calendar.holidays);
  let remaining = minutes * MINUTE;
  let cursor = start.getTime();
  let date = localDateOf(cursor, calendar.timezone);

  for (let i = 0; i < MAX_DAYS; i++) {
    for (const [ws, we] of windowsFor(date, calendar, holidays)) {
      if (we <= cursor) continue;
      const from = Math.max(ws, cursor);
      const available = we - from;
      if (remaining <= available) return new Date(from + remaining);
      remaining -= available;
      cursor = we;
    }
    date = nextDate(date);
  }
  return new Date(cursor + remaining);
}

/** `from` ile `to` arasındaki mesai dakikası (tamsayıya yuvarlanmış). `to < from` → 0. */
export function businessMinutesBetween(from: Date, to: Date, calendar: BusinessCalendar): number {
  const a = from.getTime();
  const b = to.getTime();
  if (b <= a) return 0;
  if (!hasWorkingTime(calendar)) return Math.round((b - a) / MINUTE);

  const holidays = new Set(calendar.holidays);
  let total = 0;
  let date = localDateOf(a, calendar.timezone);
  const lastDate = isoDate(localDateOf(b, calendar.timezone));

  for (let i = 0; i < MAX_DAYS; i++) {
    for (const [ws, we] of windowsFor(date, calendar, holidays)) {
      const s = Math.max(ws, a);
      const e = Math.min(we, b);
      if (e > s) total += e - s;
    }
    if (isoDate(date) >= lastDate) break;
    date = nextDate(date);
  }
  return Math.round(total / MINUTE);
}
