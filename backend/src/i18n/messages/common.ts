// Global hata handler'ının ve birden çok modülde paylaşılan generic yanıtların
// mesajları. Anahtarlar `common.` ile öneklenir.
export const commonMessages = {
  tr: {
    'common.invalidRequest': 'Geçersiz istek',
    'common.serverError': 'Sunucu hatası',
  } as Record<string, string>,
  en: {
    'common.invalidRequest': 'Invalid request',
    'common.serverError': 'Server error',
  } as Record<string, string>,
};
