import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import { SUPPORTED_LANGUAGES, type AppLanguage } from '../i18n/config';

/**
 * Dil değiştirici — TR/EN arasında geçiş yapar ve seçimi localStorage'a yazar
 * (i18next LanguageDetector `caches: ['localStorage']` ile otomatik kalıcılaştırır).
 *
 * `compact` varyantı public portalın header'ı gibi dar alanlar için sadece kod
 * gösterir (TR/EN); varsayılan varyant ikon + kod. `onDark`, temadan bağımsız
 * koyu zeminli sayfalar içindir (login ekranı gibi) — `.icon-button`'ın açık
 * zemin metin rengi koyu zeminde kontrast ihlali üretir.
 */
export function LanguageSwitcher({ compact = false, onDark = false }: { compact?: boolean; onDark?: boolean }) {
  const { i18n, t } = useTranslation();
  const current = (SUPPORTED_LANGUAGES.includes(i18n.language as AppLanguage)
    ? i18n.language
    : 'en') as AppLanguage;

  const next: AppLanguage = current === 'tr' ? 'en' : 'tr';

  const className = compact
    ? 'inline-flex items-center gap-1 rounded-control px-2 py-1 text-xs font-semibold uppercase text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
    : onDark
      ? 'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-control border border-slate-700 px-2 text-xs font-semibold uppercase text-slate-300 transition-colors hover:bg-slate-800 hover:text-white'
      : 'icon-button inline-flex items-center gap-1.5 text-xs font-semibold uppercase';

  return (
    <button
      type="button"
      onClick={() => i18n.changeLanguage(next)}
      aria-label={t('lang.switchTo')}
      title={t('lang.switchTo')}
      className={className}
    >
      <Languages className="h-4 w-4" />
      {current}
    </button>
  );
}

export default LanguageSwitcher;
