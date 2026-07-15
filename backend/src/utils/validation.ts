import { z } from 'zod';

/**
 * Ortak girdi doğrulama yapı taşları.
 *
 * Neden merkezî: aynı karar (kırp, alt sınır, üst sınır) her modülde tekrar
 * verildiğinde kaçınılmaz olarak birbirinden ayrışır. Şemadaki alan sınırları da
 * yok — Prisma `String` = Postgres `TEXT`, yani DB hiçbir uzunluğu zorlamıyor.
 * Tek backstop Fastify'ın 1 MB gövde limiti; o da alan başına değil, istek başına.
 *
 * İki kural burada bir kez doğru yapılır:
 *
 * 1. **`trim()` önce gelir.** `z.string().min(1)` `"   "` ve `"\n\t"` değerlerini
 *    KABUL EDER — "zorunlu alan" sanılan şey boşlukla geçilebiliyordu. Kırpma
 *    doğrulamadan önce yapılmalı ki alt sınır gerçek içeriği ölçsün. Kırpılmış
 *    değer aynı zamanda kaydedilen değerdir.
 * 2. **Her kalıcı metnin üst sınırı vardır.** Sınırsız alanlar kimliksiz uçlarda
 *    (ticket açıklaması, özel alan değerleri, public yanıt) depolama şişirmeye
 *    açıktı.
 *
 * Sınırlar UI ile hizalı olmalı: frontend `maxLength` aynı sayıyı kullanmalı,
 * yoksa kullanıcı yazar ve sunucudan 400 yer.
 */

/** Türkçe karakterli metinlerde de doğru çalışması için grafem değil kod birimi sayılır. */
type TextOptions = { min?: number; max: number; label: string };

/**
 * Zorunlu serbest metin — kırpılır, boş/boşluk-only reddedilir.
 * Hata mesajları Türkçe ve alan adını içerir (API sözleşmesi Türkçe mesajlar).
 */
export function requiredText({ min = 1, max, label }: TextOptions) {
  return z
    .string()
    .trim()
    .min(min, `${label} en az ${min} karakter olmalı`)
    .max(max, `${label} en fazla ${max} karakter olabilir`);
}

/**
 * Opsiyonel serbest metin — kırpılır; boş string `undefined`'a düşer.
 *
 * Boşun `undefined`'a düşmesi önemli: form alanları doldurulmadığında `''`
 * gönderir ve bu, veritabanına anlamsız boş string yazılmasına yol açardı.
 */
export function optionalText({ max, label }: Omit<TextOptions, 'min'>) {
  return z
    .string()
    .trim()
    .max(max, `${label} en fazla ${max} karakter olabilir`)
    .transform((v) => (v === '' ? undefined : v))
    .optional();
}

/**
 * Telefon numarası.
 *
 * Kasıtlı olarak geniş: TR sabit/GSM, uluslararası `+`, boşluk/tire/parantez.
 * Amaç kanonik biçim dayatmak değil — çöp veriyi ve aşırı uzunluğu engellemek.
 * Numara SMS gateway'ine JSON gövdesinde gider (URL'e değil), yani enjeksiyon
 * yüzeyi yok; buradaki kontrol veri kalitesi içindir.
 */
export const phoneSchema = z
  .string()
  .trim()
  .min(7, 'Telefon numarası çok kısa')
  .max(20, 'Telefon numarası çok uzun')
  .regex(/^[+()\d\s-]+$/, 'Telefon numarası yalnızca rakam, boşluk, +, -, ( ) içerebilir')
  .transform((v) => (v === '' ? undefined : v))
  .optional();

/** E-posta — küçük harfe indirilir, böylece aynı adres iki kayıt üretmez. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Geçerli bir e-posta adresi girin')
  .max(254, 'E-posta adresi çok uzun'); // RFC 5321

/**
 * http/https URL — başka şema kabul edilmez.
 *
 * `javascript:` gibi şemalar arayüzde `<a href>` olarak render edildiğinde
 * çalışır (React bunu engellemez), bu yüzden şema allowlist'i şart.
 */
export const httpUrlSchema = z
  .string()
  .trim()
  .max(2048, 'URL çok uzun')
  .refine(
    (v) => {
      if (v === '') return true;
      try {
        return ['http:', 'https:'].includes(new URL(v).protocol);
      } catch {
        return false;
      }
    },
    { message: 'URL yalnızca http:// veya https:// ile başlayabilir' },
  )
  .transform((v) => (v === '' ? undefined : v))
  .optional();

/**
 * Alan uzunluk sınırları — tek doğruluk kaynağı.
 *
 * Frontend `maxLength` değerleri bunlarla hizalı olmalı. Değiştirirken
 * `docs/kullanim.md`'deki tabloyu da güncelle.
 */
export const LIMITS = {
  /** Ticket konusu — kısa ve taranabilir olmalı. */
  ticketSubject: { min: 5, max: 200 },
  /** Ticket açıklaması — sorunu anlatmaya yetecek kadar, sınırsız değil. */
  ticketDescription: { min: 10, max: 5000 },
  /** Not / yanıt gövdesi. */
  noteContent: { min: 1, max: 5000 },
  /** Özel alan değeri — serbest metin, form alanı. */
  customFieldValue: { max: 2000 },
  /** Kişi adı. */
  fullName: { min: 2, max: 100 },
  /** Departman, oda, kat gibi kısa etiketler. */
  shortLabel: { max: 100 },
  /** Görev başlığı. */
  taskTitle: { min: 3, max: 300 },
  /** Görev açıklaması. */
  taskDescription: { min: 1, max: 5000 },
  /** Görev yorumu. */
  taskComment: { min: 1, max: 2000 },
  /** Serbest not alanları (randevu notu vb.). */
  notes: { max: 2000 },
} as const;
