import { mkdir, writeFile, unlink, readdir, stat } from 'fs/promises';
import { join, extname, basename, resolve, sep } from 'path';
import { Readable } from 'node:stream';
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
  const localPath = join(dir, fileName);
  // DB'ye yazılan yol GÖRELİDİR — sürücüden bağımsız.
  const filePath = `${ticketId}/${fileName}`;

  if (config.STORAGE_DRIVER === 's3') {
    await s3Put(s3Key(filePath), buffer);
  } else {
    await writeFile(localPath, buffer);
  }

  return {
    // Kullanıcıya gösterilecek ad — istemciden gelir, bu yüzden sınırlanır.
    // (Diskteki ad bu değil; yukarıdaki güvenli addır.)
    fileName: basename(originalName).substring(0, 255),
    filePath,
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
  const localPath = join(dir, fileName);
  const filePath = `branding/${companyId}/${fileName}`;

  if (config.STORAGE_DRIVER === 's3') {
    await s3Put(s3Key(filePath), buffer);
  } else {
    await writeFile(localPath, buffer);
  }

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

  // Eski logo budama: yerelde klasör taraması, S3'te prefix listesi + toplu silme.
  if (config.STORAGE_DRIVER === 's3') {
    await s3DeleteByPrefix(`${S3_KEY_PREFIX}/branding/${companyId}/`, s3Key(filePath)).catch(() => {});
  } else {
    await pruneDirectory(dir, fileName);
  }

  return {
    // Logo public bir uçtan inline servis edilir (ekler gibi indirilmez).
    url: `/branding/${companyId}/${fileName}`,
    filePath,
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
// ==================== DEPOLAMA SÜRÜCÜSÜ (v1.3: local | s3) ====================
//
// Ekler/logolar `config.STORAGE_DRIVER`'a göre yerel diske veya S3-uyumlu
// object storage'a yazılır. DB'de saklanan `filePath` HER ZAMAN UPLOAD_DIR'e
// göre GÖRELİDİR (`ticketId/name`, `branding/companyId/name`) — sürücüden
// bağımsızdır, yani kayıtlar sürücü değişiminde okunur kalır.
//
// İndirme yetkilendirmesi HER İKİ SÜRÜCÜDE backend'dedir: S3 anahtarları hiçbir
// zaman public bir bucket'a maruz kalmaz; okuma `/attachments` ve `/branding`
// uçlarından stream olarak geçer.
//
// @aws-sdk/client-s3 SADECE sürücü s3 ise dinamik import edilir: yerel
// kurulumlar SDK boyutunu/başlangıcını ödemez, birim testleri SDK'sız koşar.

const S3_KEY_PREFIX = 'uploads';

function s3Key(filePath: string): string {
  const normalized = filePath.split(sep).join('/');
  return `${S3_KEY_PREFIX}/${normalized.replace(/^\/+/, '')}`;
}

interface S3Context {
  client: {
    // Yalnızca kullanılan SDK yüzeyi — dinamik import tip karşılamak için yeterli.
    send: (command: unknown) => Promise<unknown>;
  };
  bucket: string;
}

let s3Context: S3Context | null = null;

async function getS3(): Promise<S3Context> {
  // Bağlantı bilgisi her çağrıda yeniden denetlenir (cache olsa bile) —
  // eksik yapı anlamlı hata verir, belirsiz bir SDK hatasına düşmez.
  if (config.STORAGE_DRIVER !== 's3') {
    throw new Error('S3 sürücüsü yalnızca STORAGE_DRIVER=s3 iken kullanılabilir');
  }
  if (!config.S3_BUCKET || !config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) {
    throw new Error('STORAGE_DRIVER=s3 için S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY zorunludur');
  }
  if (s3Context) return s3Context;
  // Dinamik import: yerel sürücüde SDK hiç yüklenmez.
  const { S3Client } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    region: config.S3_REGION,
    ...(config.S3_ENDPOINT
      ? {
          endpoint: config.S3_ENDPOINT,
          forcePathStyle: config.S3_FORCE_PATH_STYLE,
        }
      : {}),
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
  });
  s3Context = { client: client as unknown as S3Context['client'], bucket: config.S3_BUCKET };
  return s3Context;
}

async function s3Put(key: string, buffer: Buffer): Promise<void> {
  const s3 = await getS3();
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  await s3.client.send(new PutObjectCommand({ Bucket: s3.bucket, Key: key, Body: buffer }));
}

async function s3GetStream(key: string): Promise<Readable> {
  const s3 = await getS3();
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const out = (await s3.client.send(new GetObjectCommand({ Bucket: s3.bucket, Key: key }))) as {
    Body: Readable;
  };
  return out.Body;
}

async function s3Delete(key: string): Promise<void> {
  const s3 = await getS3();
  const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  await s3.client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: key }));
}

async function s3DeleteByPrefix(prefix: string, keepKey: string): Promise<void> {
  const s3 = await getS3();
  const { ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
  let continuationToken: string | undefined;
  do {
    const page = (await s3.client.send(new ListObjectsV2Command({
      Bucket: s3.bucket, Prefix: prefix, ContinuationToken: continuationToken,
    }))) as { Contents?: Array<{ Key?: string }>; IsTruncated?: boolean; NextContinuationToken?: string };
    const keys = (page.Contents ?? []).map((c) => c.Key).filter((k): k is string => Boolean(k) && k !== keepKey);
    if (keys.length > 0) {
      await s3.client.send(new DeleteObjectsCommand({
        Bucket: s3.bucket, Delete: { Objects: keys.map((Key) => ({ Key })) },
      }));
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
}

/** `filePath` (göreli) için okuma stream'i açar; dosya yoksa hata fırlatır. */
export async function readFileStream(filePath: string): Promise<Readable> {
  if (config.STORAGE_DRIVER === 's3') {
    try {
      return await s3GetStream(s3Key(filePath));
    } catch (err) {
      // SDK NoSuchKey hatasını olduğu gibi bırakıyoruz — çağıran 404'e çevirir.
      if ((err as { name?: string }).name === 'NoSuchKey') {
        throw Object.assign(new Error('Dosya bulunamadı'), { code: 'ENOENT' });
      }
      throw err;
    }
  }
  // Yerel sürücü: traversal koruması (deleteFile ile aynı kural).
  const root = resolve(config.UPLOAD_DIR);
  const fullPath = resolve(root, filePath);
  if (fullPath !== root && !fullPath.startsWith(root + sep)) {
    throw Object.assign(new Error('Geçersiz dosya yolu'), { code: 'ENOENT' });
  }
  // createReadStream olmayan dosyada hatayı ASYNC verir; burada senkron
  // varlık kontrolü yapılmazsa çağıran 404 yerine kırık stream gönderir.
  await stat(fullPath);
  const { createReadStream } = await import('fs');
  return createReadStream(fullPath);
}

export async function deleteFile(filePath: string): Promise<void> {
  const root = resolve(config.UPLOAD_DIR);
  const fullPath = resolve(root, filePath);

  if (fullPath !== root && !fullPath.startsWith(root + sep)) {
    throw new Error('Geçersiz dosya yolu: upload dizininin dışında');
  }

  if (config.STORAGE_DRIVER === 's3') {
    await s3Delete(s3Key(filePath)).catch(() => {});
    return;
  }

  try {
    await unlink(fullPath);
  } catch {
    // file may not exist
  }
}
