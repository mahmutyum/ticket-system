import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Dosya yükleme — uzantı ve MIME.
 *
 * Servis edilen `Content-Type` UZANTIDAN türer (hem nginx hem @fastify/static),
 * veritabanındaki `mimeType` sütunundan değil. Uzantı eskiden istemcinin dosya
 * adından olduğu gibi alınıyordu ve hiç doğrulanmıyordu:
 *
 *   Content-Type: text/plain  (allowlist'te)  +  filename="rapor.html"
 *     → diske .html olarak yazılıyor → aynı origin'den text/html servis ediliyor
 *     → depolanmış XSS
 *
 * Yani allowlist ATILAN bir değeri denetliyordu; belirleyici olan uzantı serbestti.
 * Uzantı artık yalnızca doğrulanmış MIME'dan üretilir.
 */

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'storage-test-'));
  process.env.UPLOAD_DIR = dir;
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function storage() {
  return import('../../src/services/storage.service.js');
}

describe('isAllowedMimeType', () => {
  it('izin verilen tipleri kabul eder', async () => {
    const { isAllowedMimeType } = await storage();
    expect(isAllowedMimeType('application/pdf')).toBe(true);
    expect(isAllowedMimeType('image/png')).toBe(true);
    expect(isAllowedMimeType('text/plain')).toBe(true);
  });

  it('aktif içerik tiplerini reddeder', async () => {
    const { isAllowedMimeType } = await storage();
    expect(isAllowedMimeType('text/html')).toBe(false);
    expect(isAllowedMimeType('image/svg+xml')).toBe(false);
    expect(isAllowedMimeType('application/javascript')).toBe(false);
  });
});

describe('isAllowedLogoMimeType', () => {
  it('SVG logo REDDEDİLİR', async () => {
    // SVG aktif içeriktir: <img> içinde güvenli ama doğrudan gidildiğinde
    // içindeki <script> çalışır. Logo URL'i public uçlardan dönüyor.
    const { isAllowedLogoMimeType } = await storage();
    expect(isAllowedLogoMimeType('image/svg+xml')).toBe(false);
  });

  it('raster formatları kabul eder', async () => {
    const { isAllowedLogoMimeType } = await storage();
    expect(isAllowedLogoMimeType('image/png')).toBe(true);
    expect(isAllowedLogoMimeType('image/jpeg')).toBe(true);
    expect(isAllowedLogoMimeType('image/webp')).toBe(true);
  });
});

describe('saveFile — uzantı doğrulanmış MIME\'dan gelir', () => {
  it('.html dosya adı yüklense bile diske .txt yazılır', async () => {
    // ASIL EXPLOIT: text/plain allowlist'te, filename .html.
    const { saveFile } = await storage();
    const saved = await saveFile(Buffer.from('<script>alert(1)</script>'), 'rapor.html', 'tkt1', 'text/plain');

    expect(saved.filePath.endsWith('.txt')).toBe(true);
    expect(saved.filePath).not.toContain('.html');

    const files = await readdir(join(dir, 'tkt1'));
    expect(files[0].endsWith('.txt')).toBe(true);
  });

  it('.svg dosya adı yüklense bile diske .png yazılır', async () => {
    const { saveFile } = await storage();
    const saved = await saveFile(Buffer.from('x'), 'logo.svg', 'tkt2', 'image/png');
    expect(saved.filePath.endsWith('.png')).toBe(true);
    expect(saved.filePath).not.toContain('.svg');
  });

  it('izin verilmeyen MIME ile yazmayı reddeder', async () => {
    const { saveFile } = await storage();
    await expect(saveFile(Buffer.from('x'), 'a.html', 'tkt3', 'text/html')).rejects.toThrow();
  });

  it('yol bileşenlerini dosya adından atar', async () => {
    const { saveFile } = await storage();
    const saved = await saveFile(Buffer.from('x'), '../../../etc/passwd', 'tkt4', 'text/plain');
    expect(saved.filePath).not.toContain('..');
    expect(saved.filePath.startsWith('tkt4/')).toBe(true);
  });

  it('çok uzun dosya adını sınırlar (ENAMETOOLONG → 500 idi)', async () => {
    const { saveFile } = await storage();
    const long = 'x'.repeat(300) + '.' + 'a'.repeat(300);
    const saved = await saveFile(Buffer.from('x'), long, 'tkt5', 'text/plain');
    const stored = saved.filePath.split('/')[1];
    expect(stored.length).toBeLessThan(255);
    expect(stored.endsWith('.txt')).toBe(true);
  });

  it('"a.pdf.b.pdf" adını doğru kırpar (replace ilk-eşleşme hatası)', async () => {
    const { saveFile } = await storage();
    const saved = await saveFile(Buffer.from('x'), 'a.pdf.b.pdf', 'tkt6', 'application/pdf');
    const stored = saved.filePath.split('/')[1];
    // Gövde "a.pdf.b" → sanitize → "a_pdf_b"; uzantı MIME'dan .pdf
    expect(stored).toContain('a_pdf_b');
    expect(stored.endsWith('.pdf')).toBe(true);
  });

  it('gösterilecek ad istemciden gelir ama sınırlıdır', async () => {
    const { saveFile } = await storage();
    const saved = await saveFile(Buffer.from('x'), 'Rapor Şubat.pdf', 'tkt7', 'application/pdf');
    expect(saved.fileName).toBe('Rapor Şubat.pdf');
    expect(saved.fileName.length).toBeLessThanOrEqual(255);
  });
});

describe('saveLogo', () => {
  it('SVG MIME ile yazmayı reddeder', async () => {
    const { saveLogo } = await storage();
    await expect(saveLogo(Buffer.from('<svg/>'), 'l.svg', 'co1', 'image/svg+xml')).rejects.toThrow();
  });

  it('png logoyu branding altına yazar', async () => {
    const { saveLogo } = await storage();
    const saved = await saveLogo(Buffer.from('x'), 'logo.png', 'co1', 'image/png');
    expect(saved.url.startsWith('/branding/co1/')).toBe(true);
    expect(saved.url.endsWith('.png')).toBe(true);
  });
});
