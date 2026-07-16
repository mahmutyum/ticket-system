import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import axios from 'axios';
import tr from './locales/tr.json';
import en from './locales/en.json';

/**
 * Sayfa bazlı çeviriler `./pages/<namespace>.json` dosyalarında yaşar; her dosya
 * `{ "tr": {...}, "en": {...} }` biçimindedir ve dosya adı üst düzey namespace olur
 * (ör. `pages/dashboard.json` → `t('dashboard.baslik')`).
 *
 * `import.meta.glob(..., eager)` ile derleme anında hepsi toplanır: yeni bir sayfa
 * çevirisi eklemek için sadece dosyayı oluşturmak yeterli, burada değişiklik gerekmez.
 * Bu, sayfaların paralel/bağımsız çevrilebilmesini sağlar — çekirdek sözlükleri
 * (`tr.json`/`en.json`) ile çakışma olmaz.
 */
const pageModules = import.meta.glob<{ tr: Record<string, unknown>; en: Record<string, unknown> }>(
  './pages/*.json',
  { eager: true },
);

const pageTr: Record<string, unknown> = {};
const pageEn: Record<string, unknown> = {};
for (const [path, mod] of Object.entries(pageModules)) {
  const ns = path.replace(/^.*\/([^/]+)\.json$/, '$1');
  pageTr[ns] = (mod as { tr?: unknown; default?: { tr?: unknown } }).tr ?? (mod as { default?: { tr?: unknown } }).default?.tr ?? {};
  pageEn[ns] = (mod as { en?: unknown; default?: { en?: unknown } }).en ?? (mod as { default?: { en?: unknown } }).default?.en ?? {};
}

/**
 * Çift dil (TR/EN) yapılandırması.
 *
 * Dil seçimi:
 *   1. Kullanıcı daha önce manuel seçtiyse → localStorage ('lang')
 *   2. Yoksa tarayıcı diline göre (navigator.language) → TR ise Türkçe, değilse İngilizce
 *   3. Manuel toggle her zaman tarayıcı tercihini ezer ve kalıcılaşır.
 *
 * Türkçe varsayılan değil: `navigator.language` 'tr' ile başlamıyorsa İngilizce açılır.
 * `supportedLngs` dışı bir dil (ör. 'de') İngilizce'ye düşer.
 */
export const SUPPORTED_LANGUAGES = ['tr', 'en'] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      tr: { translation: { ...tr, ...pageTr } },
      en: { translation: { ...en, ...pageEn } },
    },
    supportedLngs: SUPPORTED_LANGUAGES,
    // Desteklenmeyen/eksik dilde İngilizce'ye düş.
    fallbackLng: 'en',
    // 'tr-TR' → 'tr' gibi bölgesel varyantları temel dile indirger.
    load: 'languageOnly',
    nonExplicitSupportedLngs: true,
    interpolation: {
      // React zaten XSS'e karşı kaçışlıyor.
      escapeValue: false,
    },
    detection: {
      // Önce manuel seçim (localStorage), sonra tarayıcı.
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'lang',
      caches: ['localStorage'],
    },
  });

// `<html lang>` erişilebilirlik + tarayıcı çeviri ipuçları için dille senkron tutulur.
// Ayrıca global axios `Accept-Language` — public sayfalar ham axios kullanır, böylece
// onların da backend hata mesajları doğru dilde döner.
function syncLang(lng: string) {
  const short = lng.startsWith('tr') ? 'tr' : 'en';
  if (typeof document !== 'undefined') {
    document.documentElement.lang = short;
  }
  axios.defaults.headers.common['Accept-Language'] = short;
}
syncLang(i18n.language);
i18n.on('languageChanged', syncLang);

export default i18n;
