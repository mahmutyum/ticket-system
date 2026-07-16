import i18n from './config';

/**
 * Aktif dile karşılık gelen `Intl` locale etiketi (tarih/saat/sayı formatları için).
 *
 * Çağrı anında `i18n.language` okunur; bileşenler dil değiştiğinde `useTranslation`
 * sayesinde yeniden render olduğu için `date.toLocaleDateString(dateLocale(), …)`
 * çağrıları otomatik güncel dile göre biçimlenir.
 */
export function dateLocale(): string {
  return i18n.language?.startsWith('tr') ? 'tr-TR' : 'en-US';
}
