/**
 * SLA hesapları.
 *
 * Route handler'ının içine gömülüydü ve bu yüzden test edilemiyordu. Buradaki
 * fonksiyonlar SAFTIR: girdi alır, tarih döner, hiçbir yan etkisi yoktur.
 * `now` parametresi enjekte edilebilir — zamana bağlı testler saat kaymasına veya
 * sahte zamanlayıcılara muhtaç kalmasın.
 */

export interface SlaCategory {
  /** İlk yanıt için tanınan süre (dakika). null/0 → SLA yok. */
  slaResponseMinutes: number | null;
  /** Çözüm için tanınan süre (dakika). null/0 → SLA yok. */
  slaResolutionMinutes: number | null;
}

export interface SlaDueDates {
  slaResponseDue?: Date;
  slaResolveDue?: Date;
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
): SlaDueDates {
  const result: SlaDueDates = {};
  if (!category) return result;

  if (category.slaResponseMinutes && category.slaResponseMinutes > 0) {
    result.slaResponseDue = new Date(now.getTime() + category.slaResponseMinutes * 60_000);
  }
  if (category.slaResolutionMinutes && category.slaResolutionMinutes > 0) {
    result.slaResolveDue = new Date(now.getTime() + category.slaResolutionMinutes * 60_000);
  }
  return result;
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
