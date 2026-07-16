import type { AppLocale } from './messages.js';

/**
 * E-posta/SMS bildirimlerine enjekte edilen enum etiketleri ve serbest metinler
 * için dil yardımcıları.
 *
 * `t(request, ...)` HTTP yanıt mesajları içindir (Accept-Language). Bildirimlerde
 * ise alıcının kayıtlı dili (`ticket.locale` / `staff.locale`) kullanılır — istek
 * header'ı değil. Bu yüzden bu fonksiyonlar `locale`'i açık parametre alır.
 *
 * Frontend `i18n/labels.ts` ile aynı etiketler; ikisi elle hizalı tutulur.
 */

const PRIORITY: Record<AppLocale, Record<string, string>> = {
  tr: { low: 'Düşük', medium: 'Orta', high: 'Yüksek', critical: 'Kritik' },
  en: { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' },
};

const STATUS: Record<AppLocale, Record<string, string>> = {
  tr: {
    open: 'Açık', in_progress: 'İşlemde', waiting_user_response: 'Kullanıcı Yanıtı Bekleniyor',
    waiting_other_department: 'Diğer Birimden Destek Bekleniyor', topic_transferred: 'Konu Aktarıldı',
    process_outside_it: 'Süreç IT Dışında İlerliyor', on_hold: 'Beklemede', resolved: 'Çözüldü', closed: 'Kapatıldı',
  },
  en: {
    open: 'Open', in_progress: 'In Progress', waiting_user_response: 'Awaiting User Response',
    waiting_other_department: 'Awaiting Other Department', topic_transferred: 'Transferred',
    process_outside_it: 'Handled Outside IT', on_hold: 'On Hold', resolved: 'Resolved', closed: 'Closed',
  },
};

const ONSITE_TYPE: Record<AppLocale, Record<string, string>> = {
  tr: { come_to_it_room: 'IT Odasına Gel', meeting_room: 'Toplantı Odası', visit_employee: 'Çalışanı Ziyaret' },
  en: { come_to_it_room: 'Come to IT Room', meeting_room: 'Meeting Room', visit_employee: 'Visit Employee' },
};

const norm = (locale: string): AppLocale => (locale === 'en' ? 'en' : 'tr');

export const priorityLabel = (locale: string, code: string): string =>
  PRIORITY[norm(locale)][code] ?? code;
export const statusLabel = (locale: string, code: string): string =>
  STATUS[norm(locale)][code] ?? code;
export const onsiteTypeLabel = (locale: string, code: string): string =>
  ONSITE_TYPE[norm(locale)][code] ?? code;

/** Yerinde destek planlama e-postasındaki yönlendirme notu (oda bilgisiyle). */
export function onsiteScheduledNote(locale: string, type: string, place: string): string {
  if (norm(locale) === 'en') {
    if (type === 'come_to_it_room') return `Please come to the IT room (${place}) at the scheduled time.`;
    if (type === 'meeting_room') return `Please come to the meeting room (${place}) at the scheduled time.`;
    return 'The IT team will come to you at the scheduled time.';
  }
  if (type === 'come_to_it_room') return `Lütfen belirtilen saatte IT odasına (${place}) geliniz.`;
  if (type === 'meeting_room') return `Lütfen belirtilen saatte toplantı odasına (${place}) geliniz.`;
  return 'IT ekibi belirtilen saatte size gelecektir.';
}

export const onsiteCancelledTypeLabel = (locale: string): string =>
  norm(locale) === 'en' ? 'CANCELLED' : 'İPTAL EDİLDİ';
export const onsiteCancelledNote = (locale: string): string =>
  norm(locale) === 'en' ? 'Your onsite support appointment has been cancelled.' : 'Yerinde destek randevunuz iptal edilmiştir.';
export const onsiteUpdatedNote = (locale: string): string =>
  norm(locale) === 'en' ? 'Your onsite support appointment has been updated.' : 'Yerinde destek randevunuz güncellendi.';

/** Bildirimlerde tarih/saat — alıcının diline göre biçimlenir. */
export function formatDateTime(locale: string, value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleString(norm(locale) === 'en' ? 'en-US' : 'tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
