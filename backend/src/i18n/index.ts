import type { FastifyRequest } from 'fastify';
import { messages, type AppLocale } from './messages.js';

/**
 * API yanıt mesajları için basit i18n katmanı.
 *
 * Dil `Accept-Language` header'ından çözülür (frontend axios interceptor'ı aktif
 * dili gönderir). 'en' ile başlıyorsa İngilizce, aksi hâlde Türkçe (varsayılan —
 * uygulama Türkçe önceliklidir). Bilinmeyen bir anahtar veya eksik çeviri Türkçeye,
 * o da yoksa anahtarın kendisine düşer.
 *
 * NOT: Zod alan-bazlı doğrulama mesajları buraya dahil DEĞİLDİR — global hata
 * handler'ı production'da onları "Geçersiz istek"e indirger (şema yapısını sızdırmamak
 * için), bu yüzden yalnızca elle yazılmış `error:` yanıtları ve generic handler
 * mesajları çevrilir.
 */
export function resolveLocale(req: Pick<FastifyRequest, 'headers'>): AppLocale {
  const header = String(req.headers['accept-language'] || '').toLowerCase();
  return header.startsWith('en') ? 'en' : 'tr';
}

export function t(
  req: Pick<FastifyRequest, 'headers'>,
  key: string,
  params?: Record<string, string | number>,
): string {
  const locale = resolveLocale(req);
  const table = messages[locale] ?? messages.tr;
  let msg = table[key] ?? messages.tr[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      msg = msg.split(`{${k}}`).join(String(v));
    }
  }
  return msg;
}
