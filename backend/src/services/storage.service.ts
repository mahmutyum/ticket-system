import { mkdir, writeFile, unlink, readdir } from 'fs/promises';
import { join, extname, basename, resolve, sep } from 'path';
import { nanoid } from 'nanoid';
import { config } from '../config/index.js';

/**
 * İzin verilen MIME tipleri → diske yazılacak KANONİK uzantı.
 *
 * Uzantı neden buradan geliyor: yanıtın `Content-Type`'ı uzantıdan türetilir
 * (hem eski statik servis hem yeni /branding ucu böyle çalışır), veritabanındaki
 * `mimeType` sütunundan değil.
 *
 * Önceden uzantı istemcinin gönderdiği dosya adından olduğu gibi alınıyordu ve
 * hiç doğrulanmıyordu. Sonuç: `Content-Type: text/plain` (allowlist'te) +
 * `filename="rapor.html"` → dosya `.html` uzantısıyla yazılıyor → aynı origin'den
 * `text/html` olarak servis ediliyor → depolanmış XSS. Allowlist, atılan bir
 * değeri denetliyordu; gerçekte belirleyici olan uzantı serbestti.
 *
 * Artık uzantı yalnızca bu tablodan gelir. İstemci `image/png` deyip HTML byte'ı
 * yüklerse dosya `.png` olur ve `nosniff` ile birlikte tarayıcı onu HTML olarak
 * yorumlamaz.
 */
const ALLOWED_MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/zip': '.zip',
  'application/x-rar-compressed': '.rar',
};

export function isAllowedMimeType(mimeType: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED_MIME_EXTENSIONS, mimeType);
}

/**
 * İçerik (magic-byte) doğrulaması.
 *
 * `Content-Type` istemci beyanıdır. `nosniff` + `Content-Disposition: attachment`
 * zaten aktif-içerik çalıştırmayı engelliyor; bu katman bir adım öteye gider:
 * beyan edilen tipin GERÇEK dosya imzasıyla tutarlı olmasını şart koşar. Böylece
 * "image/png diyeyim ama içine HTML/exe koyayım" gibi tür karıştırma denemeleri
 * diske hiç yazılmadan reddedilir.
 *
 * İmzası olmayan düz metin tipleri (`text/plain`, `text/csv`) doğal olarak
 * doğrulanamaz — onlar için beyan kabul edilir (aktif-içerik riski nosniff +
 * attachment ile zaten kapalı).
 */
type SignatureCheck = (buf: Buffer) => boolean;

const startsWith = (bytes: number[]): SignatureCheck => (buf) =>
  buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b);

// MIME → beyanın geçerli sayılması için eşleşmesi gereken imzalar (biri yeterli).
// İmzası tanımlı OLMAYAN tipler (text/plain, text/csv) bilerek dışarıda: onlar
// için içerik doğrulaması yapılmaz.
const MIME_SIGNATURES: Record<string, SignatureCheck[]> = {
  'image/jpeg': [startsWith([0xff, 0xd8, 0xff])],
  'image/png': [startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  'image/gif': [startsWith([0x47, 0x49, 0x46, 0x38])], // GIF8
  // RIFF....WEBP — ilk 4 byte RIFF, 8-11 arası WEBP.
  'image/webp': [(buf) =>
    buf.length >= 12 &&
    startsWith([0x52, 0x49, 0x46, 0x46])(buf) &&
    buf.slice(8, 12).toString('ascii') === 'WEBP'],
  'application/pdf': [startsWith([0x25, 0x50, 0x44, 0x46])], // %PDF
  // ZIP tabanlı (docx/xlsx dahil) — PK\x03\x04 / boş arşiv / spanned.
  'application/zip': [startsWith([0x50, 0x4b, 0x03, 0x04]), startsWith([0x50, 0x4b, 0x05, 0x06]), startsWith([0x50, 0x4b, 0x07, 0x08])],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [startsWith([0x50, 0x4b, 0x03, 0x04])],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [startsWith([0x50, 0x4b, 0x03, 0x04])],
  'application/x-rar-compressed': [startsWith([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])], // Rar!\x1a\x07
  // Eski Office (OLE Compound File): D0 CF 11 E0 A1 B1 1A E1
  'application/msword': [startsWith([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
  'application/vnd.ms-excel': [startsWith([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
};

export function isBufferConsistentWithMime(buffer: Buffer, mimeType: string): boolean {
  const checks = MIME_SIGNATURES[mimeType];
  // İmza tanımlı değilse (text/plain, text/csv) içerik doğrulanamaz — beyanı kabul et.
  if (!checks) return true;
  return checks.some((check) => check(buffer));
}

/**
 * Logo MIME'ları.
 *
 * `image/svg+xml` BİLEREK YOK. SVG aktif içerik formatıdır: `<img>` içinde
 * güvenlidir ama `/branding/...svg` adresine doğrudan gidildiğinde
 * üst seviye bir belge olur ve içindeki `<script>` çalışır. Logo URL'i public
 * uçlardan (`GET /companies/`) döndüğü için bu adres herkese açıktır.
 */
const ALLOWED_LOGO_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export function isAllowedLogoMimeType(mimeType: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED_LOGO_EXTENSIONS, mimeType);
}

/** Dosya adının gövdesi için üst sınır — tam yol NAME_MAX'ı (255) aşmamalı. */
const MAX_NAME_LENGTH = 50;

/**
 * Diske yazılacak güvenli dosya adı üretir.
 *
 * - Gövde: istemcinin adından, yalnızca `[a-zA-Z0-9_-]`, en fazla 50 karakter.
 * - Uzantı: **doğrulanmış MIME'dan**, istemcinin adından DEĞİL.
 * - Önek: `nanoid(12)` — çakışmayı ve `.` ile başlamayı engeller.
 *
 * `basename()` ile önce yol bileşenleri atılır (savunma katmanı; `extname` zaten
 * ayraç geçemez ama gövdeyi istemciden aldığımız için açıkça temizliyoruz).
 */
function buildStoredFilename(original: string, extension: string): string {
  const base = basename(original);
  const ext = extname(base);
  // `replace(ext, '')` KULLANILMAZ: ilk eşleşmeyi siler, yani "a.pdf.b.pdf"
  // yanlış yerden kırpılırdı. Uzunluğa göre kes.
  const stem = ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;

  const safeStem = stem.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, MAX_NAME_LENGTH);
  return `${nanoid(12)}_${safeStem}${extension}`;
}

export async function saveFile(
  buffer: Buffer,
  originalName: string,
  ticketId: string,
  mimeType: string,
): Promise<{ fileName: string; filePath: string; fileSize: number }> {
  const extension = ALLOWED_MIME_EXTENSIONS[mimeType];
  if (!extension) {
    // Çağıran isAllowedMimeType ile önceden kontrol etmeli; burası son emniyet.
    throw new Error(`İzin verilmeyen dosya tipi: ${mimeType}`);
  }

  const dir = join(config.UPLOAD_DIR, ticketId);
  await mkdir(dir, { recursive: true });

  const fileName = buildStoredFilename(originalName, extension);
  const filePath = join(dir, fileName);

  await writeFile(filePath, buffer);

  return {
    // Kullanıcıya gösterilecek ad — istemciden gelir, bu yüzden sınırlanır.
    // (Diskteki ad bu değil; yukarıdaki güvenli addır.)
    fileName: basename(originalName).substring(0, 255),
    filePath: `${ticketId}/${fileName}`,
    fileSize: buffer.length,
  };
}

export async function saveLogo(
  buffer: Buffer,
  originalName: string,
  companyId: string,
  mimeType: string,
): Promise<{ url: string; filePath: string }> {
  const extension = ALLOWED_LOGO_EXTENSIONS[mimeType];
  if (!extension) {
    throw new Error(`İzin verilmeyen logo tipi: ${mimeType}`);
  }

  const dir = join(config.UPLOAD_DIR, 'branding', companyId);
  await mkdir(dir, { recursive: true });

  const fileName = buildStoredFilename(originalName, extension);
  const filePath = join(dir, fileName);
  await writeFile(filePath, buffer);

  // Eski logoyu sil. Dosya adı her yüklemede rastgele (nanoid) olduğu için yeni
  // logo eskisinin ÜZERİNE yazmaz — temizlenmezse her yeniden yükleme diskte bir
  // dosya bırakır ve bu dosyalar `/branding` ucundan süresizce erişilebilir kalır.
  //
  // Silinecek dosyayı DB'deki `logo` string'ini ayrıştırarak bulmak yerine
  // klasördeki diğer dosyaları buduyoruz: şirket başına tek logo invaryantı
  // burada, kaydın yanında zorlanmış olur ve önceden birikmiş yetimler de
  // temizlenir. Ayrıca yola çevrilecek bir string olmadığı için traversal yüzeyi
  // yok.
  await pruneDirectory(dir, fileName);

  return {
    // Logo public bir uçtan inline servis edilir (ekler gibi indirilmez).
    url: `/branding/${companyId}/${fileName}`,
    filePath: `branding/${companyId}/${fileName}`,
  };
}

/** `dir` içinde `keep` dışındaki dosyaları siler. Hata yutulur: temizlik, asıl işi bozmamalı. */
async function pruneDirectory(dir: string, keep: string): Promise<void> {
  try {
    const entries = await readdir(dir);
    await Promise.all(
      entries
        .filter((name) => name !== keep)
        .map((name) => unlink(join(dir, name)).catch(() => {})),
    );
  } catch {
    // dizin okunamadı — yükleme yine de başarılı sayılır
  }
}

/**
 * `UPLOAD_DIR` içindeki bir dosyayı siler.
 *
 * `filePath` DAİMA UPLOAD_DIR'e göre göreli olmalıdır. Çağıran güvenilir olsa da
 * kapsama kontrolü yapılır: `join()` `../` segmentlerini sadeleştirir, yani
 * doğrulanmamış bir `filePath` upload dizininin dışına çıkabilir ve rastgele dosya
 * sildirebilir. Bugün tüm çağıranlar sabit yollar veriyor; bu kontrol bunun
 * yarın da doğru kalmasını sağlar.
 */
export async function deleteFile(filePath: string): Promise<void> {
  const root = resolve(config.UPLOAD_DIR);
  const fullPath = resolve(root, filePath);

  if (fullPath !== root && !fullPath.startsWith(root + sep)) {
    throw new Error('Geçersiz dosya yolu: upload dizininin dışında');
  }

  try {
    await unlink(fullPath);
  } catch {
    // file may not exist
  }
}
