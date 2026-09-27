/**
 * SLA hesapları.
 *
 * Route handler'ının içine gömülüydü ve bu yüzden test edilemiyordu. Buradaki
 * fonksiyonlar SAFTIR: girdi alır, tarih döner, hiçbir yan etkisi yoktur.
 * `now` parametresi enjekte edilebilir — zamana bağlı testler saat kaymasına veya
 * sahte zamanlayıcılara muhtaç kalmasın.
 *
 * `calendar` verilirse süreler yalnızca mesai dakikası olarak sayılır; `null`
 * ise 7/24 (duvar saati) işler.
 */

import { addBusinessMinutes, businessMinutesBetween, type BusinessCalendar } from './business-hours.js';

export interface SlaCategory {
  /** İlk yanıt için tanınan süre (dakika). null/0 → SLA yok. */
  slaResponseMinutes: number | null;
  /** Çözüm için tanınan süre (dakika). null/0 → SLA yok. */
  slaResolutionMinutes: number | null;
}

export interface SlaDueDates {
  slaResponseDue?: Date;
  slaResolveDue?: Date;
  /** İhlal öncesi uyarı anı (süre `warningPercent` kadar dolduğunda). */
  slaResponseWarnAt?: Date;
  slaResolveWarnAt?: Date;
}

export interface SlaOptions {
  calendar?: BusinessCalendar | null;
  /** 0 → ihlal öncesi uyarı yok. */
  warningPercent?: number;
}

function addMinutes(start: Date, minutes: number, calendar: BusinessCalendar | null | undefined): Date {
  return calendar ? addBusinessMinutes(start, minutes, calendar) : new Date(start.getTime() + minutes * 60_000);
}

/**
 * Bir ticket açılırken SLA son tarihlerini hesaplar.
 *
 * Kategoride süre tanımlı değilse ilgili alan `undefined` kalır — yani o ticket
 * için o SLA hiç işlemez. `0` da SLA yok sayılır: "sıfır dakika" anlamlı bir
 * hedef değildir ve tanımsızlıkla aynı şekilde ele alınmalıdır.
 */
export function calculateSlaDueDates(
  category: SlaCategory | null | undefined,
  now: Date = new Date(),
  options: SlaOptions = {},
): SlaDueDates {
  const result: SlaDueDates = {};
  if (!category) return result;
  const { calendar, warningPercent = 0 } = options;
  const warnMinutes = (minutes: number) => Math.floor((minutes * warningPercent) / 100);

  if (category.slaResponseMinutes && category.slaResponseMinutes > 0) {
    result.slaResponseDue = addMinutes(now, category.slaResponseMinutes, calendar);
    if (warnMinutes(category.slaResponseMinutes) > 0) {
      result.slaResponseWarnAt = addMinutes(now, warnMinutes(category.slaResponseMinutes), calendar);
    }
  }
  if (category.slaResolutionMinutes && category.slaResolutionMinutes > 0) {
    result.slaResolveDue = addMinutes(now, category.slaResolutionMinutes, calendar);
    if (warnMinutes(category.slaResolutionMinutes) > 0) {
      result.slaResolveWarnAt = addMinutes(now, warnMinutes(category.slaResolutionMinutes), calendar);
    }
  }
  return result;
}

/**
 * Duraklatma sonrası bir SLA anını ileri kaydırır.
 *
 * Duraklatıldığı anda kalan süre (mesai takvimine göre) korunur ve devam anından
 * itibaren yeniden eklenir. Duraklatılmadan ÖNCE zaten geçmiş bir an (ihlal
 * gerçekleşmiş ya da uyarı gönderilmiş) değişmez — geçmişteki bir ihlal
 * duraklatmayla silinemez.
 */
export function shiftAfterPause(
  instant: Date | null | undefined,
  pausedAt: Date,
  resumedAt: Date,
  calendar: BusinessCalendar | null | undefined,
): Date | null {
  if (!instant) return null;
  if (instant <= pausedAt) return instant;
  if (!calendar) return new Date(instant.getTime() + (resumedAt.getTime() - pausedAt.getTime()));
  const remaining = businessMinutesBetween(pausedAt, instant, calendar);
  return addBusinessMinutes(resumedAt, remaining, calendar);
}

/** İki an arasındaki SLA dakikası (takvim varsa mesai dakikası). */
export function slaMinutesBetween(from: Date, to: Date, calendar: BusinessCalendar | null | undefined): number {
  if (to <= from) return 0;
  return calendar ? businessMinutesBetween(from, to, calendar) : Math.round((to.getTime() - from.getTime()) / 60_000);
}

/**
 * SLA hedefi tutturuldu mu?
 *
 * `due` yoksa (kategoride SLA tanımlı değil) `null` döner — "tutturuldu" ya da
 * "kaçırıldı" demek yanlış olur, ölçülecek bir hedef yok. Bu ayrım raporlarda
 * önemli: uyum oranı yalnızca SLA'sı OLAN ticket'lar üzerinden hesaplanmalı,
 * yoksa hedefsiz ticket'lar oranı şişirir.
 *
 * Sınır dahildir: tam son tarihte gelen yanıt tutturmuş sayılır.
 */
export function isSlaMet(due: Date | null | undefined, actual: Date): boolean | null {
  if (!due) return null;
  return actual <= due;
}

/**
 * SLA aşıldı mı? (henüz kapanmamış ticket'lar için)
 *
 * `met` zaten belirlenmişse (yanıt verilmiş/çözülmüş) ihlal sayılmaz — geçmişte
 * kalan bir hedefin şimdi ihlal edilmesi mümkün değildir.
 */
export function isSlaBreached(
  due: Date | null | undefined,
  met: boolean | null,
  now: Date = new Date(),
): boolean {
  if (!due) return false;
  if (met !== null) return false;
  return now > due;
}
