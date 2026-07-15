import { mkdir, writeFile, unlink } from 'fs/promises';
import { join, extname, basename } from 'path';
import { nanoid } from 'nanoid';
import { config } from '../config/index.js';

/**
 * İzin verilen MIME tipleri → diske yazılacak KANONİK uzantı.
 *
 * Uzantı neden buradan geliyor: dosyalar `/uploads/` altından statik servis
 * edilir ve hem nginx hem `@fastify/static` yanıtın `Content-Type`'ını
 * **uzantıdan** türetir — veritabanındaki `mimeType` sütunundan değil.
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
 * Logo MIME'ları.
 *
 * `image/svg+xml` BİLEREK YOK. SVG aktif içerik formatıdır: `<img>` içinde
 * güvenlidir ama `/uploads/branding/...svg` adresine doğrudan gidildiğinde
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

  return {
    url: `/uploads/branding/${companyId}/${fileName}`,
    filePath: `branding/${companyId}/${fileName}`,
  };
}

export async function deleteFile(filePath: string): Promise<void> {
  const fullPath = join(config.UPLOAD_DIR, filePath);
  try {
    await unlink(fullPath);
  } catch {
    // file may not exist
  }
}
