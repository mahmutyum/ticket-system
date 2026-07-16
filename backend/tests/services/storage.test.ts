import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readdir, writeFile, mkdir, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, basename } from 'path';

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

describe('isBufferConsistentWithMime — magic-byte doğrulaması', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const PDF = Buffer.from('%PDF-1.7\n...');
  const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);
  const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
  const HTML = Buffer.from('<!doctype html><script>alert(1)</script>');

  it('gerçek imzayı beyanla eşleşince kabul eder', async () => {
    const { isBufferConsistentWithMime } = await storage();
    expect(isBufferConsistentWithMime(PNG, 'image/png')).toBe(true);
    expect(isBufferConsistentWithMime(JPEG, 'image/jpeg')).toBe(true);
    expect(isBufferConsistentWithMime(PDF, 'application/pdf')).toBe(true);
    expect(isBufferConsistentWithMime(WEBP, 'image/webp')).toBe(true);
    expect(isBufferConsistentWithMime(ZIP, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(true);
  });

  it('tür karıştırmayı REDDEDER (image/png beyan et, HTML gönder)', async () => {
    const { isBufferConsistentWithMime } = await storage();
    expect(isBufferConsistentWithMime(HTML, 'image/png')).toBe(false);
    expect(isBufferConsistentWithMime(HTML, 'application/pdf')).toBe(false);
    expect(isBufferConsistentWithMime(PNG, 'image/jpeg')).toBe(false);
  });

  it('imzası olmayan metin tipleri için beyanı kabul eder', async () => {
    const { isBufferConsistentWithMime } = await storage();
    // text/plain, text/csv güvenilir imza taşımaz — nosniff+attachment ile korunur.
    expect(isBufferConsistentWithMime(Buffer.from('herhangi bir metin'), 'text/plain')).toBe(true);
    expect(isBufferConsistentWithMime(Buffer.from('a,b,c'), 'text/csv')).toBe(true);
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

/**
 * Logo değiştirme — disk sızıntısı.
 *
 * Dosya adı her yüklemede rastgele (nanoid), yani yeni logo eskisinin ÜZERİNE
 * yazmaz. Temizlik olmadan her yeniden yükleme diskte kalıcı bir dosya bırakıyordu
 * ve o dosya `/branding` public ucundan süresizce erişilebiliyordu — DB'de artık
 * referansı olmasa bile.
 */
describe('saveLogo — eski logoyu temizler', () => {
  it('yeniden yükleme eski dosyayı diskte BIRAKMAZ', async () => {
    const { saveLogo } = await storage();
    const brandingDir = join(dir, 'branding', 'cleanup-co');

    const first = await saveLogo(Buffer.from('eski'), 'a.png', 'cleanup-co', 'image/png');
    expect(await readdir(brandingDir)).toHaveLength(1);

    const second = await saveLogo(Buffer.from('yeni'), 'b.png', 'cleanup-co', 'image/png');

    const remaining = await readdir(brandingDir);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toBe(second.url.split('/').pop());
    // Eski dosya gerçekten gitti — URL'si artık bir dosyaya çözülmüyor.
    expect(remaining).not.toContain(first.url.split('/').pop());
  });

  it('önceden birikmiş yetimleri de toplar', async () => {
    const { saveLogo } = await storage();
    const brandingDir = join(dir, 'branding', 'orphan-co');

    await saveLogo(Buffer.from('1'), 'a.png', 'orphan-co', 'image/png');
    // Temizlik yokmuş gibi elle yetim bırak (eski sürümün ürettiği durum).
    await writeFile(join(brandingDir, 'yetim.png'), Buffer.from('eski'));
    expect(await readdir(brandingDir)).toHaveLength(2);

    await saveLogo(Buffer.from('2'), 'b.png', 'orphan-co', 'image/png');

    expect(await readdir(brandingDir)).toHaveLength(1);
  });

  it('şirketleri birbirinden ayırır — biri diğerinin logosunu silmez', async () => {
    const { saveLogo } = await storage();
    await saveLogo(Buffer.from('a'), 'a.png', 'iso-a', 'image/png');
    await saveLogo(Buffer.from('b'), 'b.png', 'iso-b', 'image/png');

    expect(await readdir(join(dir, 'branding', 'iso-a'))).toHaveLength(1);
    expect(await readdir(join(dir, 'branding', 'iso-b'))).toHaveLength(1);
  });
});

/**
 * `deleteFile` kapsama kontrolü.
 *
 * `join(UPLOAD_DIR, filePath)` `../` segmentlerini sadeleştirir: doğrulanmamış bir
 * `filePath` upload dizininin dışına çıkıp rastgele dosya sildirebilir. Bugün tüm
 * çağıranlar sabit yol veriyor — bu testler bunun yarın da doğru kalmasını sağlar.
 */
describe('deleteFile', () => {
  it('upload dizini içindeki dosyayı siler', async () => {
    const { deleteFile } = await storage();
    await mkdir(join(dir, 'del'), { recursive: true });
    await writeFile(join(dir, 'del', 'x.txt'), 'x');

    await deleteFile('del/x.txt');

    expect(await readdir(join(dir, 'del'))).toHaveLength(0);
  });

  it('dizin dışına çıkan yolu REDDEDER', async () => {
    const { deleteFile } = await storage();
    const victim = join(dir, '..', `kurban-${Date.now()}.txt`);
    await writeFile(victim, 'silinmemeli');

    try {
      await expect(deleteFile(`../${basename(victim)}`)).rejects.toThrow(/upload dizininin dışında/);
      // Dosya hâlâ duruyor.
      await expect(readFile(victim, 'utf8')).resolves.toBe('silinmemeli');
    } finally {
      await rm(victim, { force: true });
    }
  });

  it('mutlak yolu REDDEDER', async () => {
    const { deleteFile } = await storage();
    await expect(deleteFile('/etc/passwd')).rejects.toThrow(/upload dizininin dışında/);
  });

  it('olmayan dosyada sessizce geçer', async () => {
    const { deleteFile } = await storage();
    await expect(deleteFile('yok/olmayan.txt')).resolves.toBeUndefined();
  });
});

/**
 * Web shell yükleme denemeleri.
 *
 * Klasik saldırı: shell.php yükle → /uploads/shell.php iste → RCE.
 * Zincirin her halkası ayrı kırılmalı; bu testler ilk halkayı (diske hangi adla
 * yazıldığını) tutar. Uzantı YALNIZCA doğrulanmış MIME'dan gelir, istemcinin
 * gönderdiği addan değil.
 */
describe('saveFile — shell yükleme denemeleri', () => {
  const SHELL_NAMES = [
    'shell.php',
    'shell.php5',
    'shell.phtml',
    'shell.jsp',
    'shell.asp',
    'shell.aspx',
    'shell.cgi',
    'shell.sh',
    'shell.html',
    'shell.svg',
    // Çift uzantı numaraları
    'shell.pdf.php',
    'shell.php.pdf',
    'shell.php.jpg',
    'shell.jpg.php',
    // Null byte / boşluk ile uzantı gizleme
    'shell.php%00.pdf',
    'shell.php .pdf',
    // Yol enjeksiyonu
    '../../etc/cron.d/evil.php',
    '..%2f..%2fshell.php',
  ];

  for (const name of SHELL_NAMES) {
    it(`"${name}" çalıştırılabilir uzantıyla YAZILMAZ`, async () => {
      const { saveFile } = await storage();
      // Saldırgan izin verilen bir MIME beyan eder; uzantı ONDAN türetilir.
      const saved = await saveFile(Buffer.from('<?php system($_GET["c"]); ?>'), name, 'shelltest', 'application/pdf');

      // Diskteki ad .pdf ile biter — beyan edilen MIME'ın kanonik uzantısı.
      expect(saved.filePath.endsWith('.pdf')).toBe(true);

      // Ve içinde HİÇBİR çalıştırılabilir uzantı geçmez.
      expect(saved.filePath).not.toMatch(/\.(php\d?|phtml|jsp|asp|aspx|cgi|sh|html?|svg)(\.|$)/i);

      // Yol enjeksiyonu yok: ticket dizininin dışına çıkılmamış.
      expect(saved.filePath.startsWith('shelltest/')).toBe(true);
      expect(saved.filePath).not.toContain('..');
    });
  }

  it('gerçekten .php uzantısı üreten bir MIME YOK', async () => {
    const { isAllowedMimeType } = await storage();
    // Allowlist'te aktif içerik tipi bulunmamalı.
    for (const m of [
      'application/x-httpd-php',
      'text/html',
      'image/svg+xml',
      'application/x-sh',
      'text/x-php',
      'application/javascript',
    ]) {
      expect(isAllowedMimeType(m), `${m} allowlist'te OLMAMALI`).toBe(false);
    }
  });

  it('reddedilen MIME hiç dosya yazmaz', async () => {
    const { saveFile } = await storage();
    await expect(
      saveFile(Buffer.from('x'), 'a.php', 'shelltest2', 'application/x-httpd-php'),
    ).rejects.toThrow(/İzin verilmeyen/);
  });
});
