import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Depolama sürücüsü katmanı (v1.3: local | s3).
 *
 * Local sürücü gerçek dosya sistemiyle test edilir (traversal koruması dahil);
 * S3 sürücü SDK mock'lu koşar — doğrulanan şey anahtar/format/sürücü dallanmasıdır,
 * AWS API'si değil.
 */

const UPLOAD_DIR = join(tmpdir(), 'storage-test-' + Math.random().toString(36).slice(2));

const configMock = {
  UPLOAD_DIR: UPLOAD_DIR,
  STORAGE_DRIVER: 'local' as 'local' | 's3',
  S3_ENDPOINT: undefined as string | undefined,
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'test-bucket' as string | undefined,
  S3_ACCESS_KEY_ID: 'key' as string | undefined,
  S3_SECRET_ACCESS_KEY: 'secret' as string | undefined,
  S3_FORCE_PATH_STYLE: false,
};

vi.mock('../../src/config/index.js', () => ({ config: configMock }));

// SDK dinamik import edilir — vi.mock modül kayıt defterini yakalar.
const sendMock = vi.fn();
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = sendMock;
  },
  PutObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
  GetObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
  DeleteObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
  ListObjectsV2Command: class {
    constructor(public input: Record<string, unknown>) {}
  },
  DeleteObjectsCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));

beforeEach(() => {
  sendMock.mockReset();
  configMock.STORAGE_DRIVER = 'local';
});

describe('saveFile + readFileStream — local sürücü', () => {
  it('göreli yola yazar ve geri okur; DB kaydı sürücüden bağımsız kalır', async () => {
    const { saveFile, readFileStream } = await import('../../src/services/storage.service.js');
    const saved = await saveFile(Buffer.from('merhaba'), 'rapor.txt', 't1', 'text/plain');
    expect(saved.filePath).toMatch(/^t1\/[A-Za-z0-9_-]+\.txt$/);

    const stream = await readFileStream(saved.filePath);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('merhaba');

    await rm(UPLOAD_DIR, { recursive: true, force: true });
  });

  it('readFileStream traversal koruması: ../ ile kök dışına çıkamaz', async () => {
    const { readFileStream } = await import('../../src/services/storage.service.js');
    await expect(readFileStream('../../package.json')).rejects.toThrow();
    await expect(readFileStream('t1/../../etc/passwd')).rejects.toThrow();
  });
});

describe('deleteFile — sürücü dallanması', () => {
  it('local sürücüde dosyayı siler', async () => {
    const { saveFile, deleteFile, readFileStream } = await import('../../src/services/storage.service.js');
    const saved = await saveFile(Buffer.from('geçici'), 'a.txt', 't2', 'text/plain');
    await deleteFile(saved.filePath);
    await expect(readFileStream(saved.filePath)).rejects.toThrow();
  });

  it('S3 sürücüsünde DeleteObject çağırır (local fs yazmaz)', async () => {
    configMock.STORAGE_DRIVER = 's3';
    sendMock.mockResolvedValue({});
    const { saveFile, deleteFile } = await import('../../src/services/storage.service.js');
    const saved = await saveFile(Buffer.from('x'), 'a.txt', 't3', 'text/plain');
    await deleteFile(saved.filePath);
    const calls = sendMock.mock.calls.map((c) => c[0]?.constructor?.name);
    expect(calls).toContain('PutObjectCommand');
    expect(calls).toContain('DeleteObjectCommand');
    // Key prefix'i: uploads/<göreli yol>
    const putInput = sendMock.mock.calls.find((c) => c[0]?.constructor?.name === 'PutObjectCommand')![0].input as Record<string, unknown>;
    expect(putInput.Bucket).toBe('test-bucket');
    expect(String(putInput.Key)).toMatch(/^uploads\/t3\//);
  });
});

describe('S3 sürücüsü — okuma ve logo budama', () => {
  it('GetObject stream döner; NoSuchKey ENOENT benzeri hataya çevrilir', async () => {
    configMock.STORAGE_DRIVER = 's3';
    const { Readable } = await import('node:stream');
    sendMock.mockImplementation((command) => {
      if (command.constructor.name === 'GetObjectCommand') {
        if (command.input.Key === 'uploads/t4/exists.txt') {
          return { Body: Readable.from([Buffer.from('ok')]) };
        }
        const err = new Error('The specified key does not exist.');
        err.name = 'NoSuchKey';
        throw err;
      }
      return {};
    });
    const { readFileStream } = await import('../../src/services/storage.service.js');
    const stream = await readFileStream('t4/exists.txt');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('ok');
    await expect(readFileStream('t4/missing.txt')).rejects.toThrow(/bulunamadı/);
  });

  it('saveLogo S3 modunda eski logoları prefix ile budar', async () => {
    configMock.STORAGE_DRIVER = 's3';
    sendMock.mockImplementation((command) => {
      if (command.constructor.name === 'ListObjectsV2Command') {
        return {
          Contents: [
            { Key: 'uploads/branding/c1/old1.png' },
            { Key: 'uploads/branding/c1/old2.png' },
            { Key: 'uploads/branding/c1/new.png' }, // keep — saveFile az önce yazdı
          ],
          IsTruncated: false,
        };
      }
      return {};
    });
    const { saveLogo } = await import('../../src/services/storage.service.js');
    const saved = await saveLogo(Buffer.from('png'), 'logo.png', 'c1', 'image/png');
    expect(saved.url).toBe('/branding/c1/' + saved.filePath.split('/').at(-1));
    const deleteBatch = sendMock.mock.calls.find((c) => c[0]?.constructor?.name === 'DeleteObjectsCommand');
    expect(deleteBatch).toBeTruthy();
    const keys = (deleteBatch![0].input.Delete.Objects as Array<{ Key: string }>).map((o) => o.Key);
    expect(keys).toContain('uploads/branding/c1/old1.png');
    expect(keys).not.toContain(saved.filePath.replace(/^\/?/, 'uploads/'));
  });

  it('STORAGE_DRIVER=s3 ama eksik bağlantı bilgisinde anlamlı hata', async () => {
    configMock.STORAGE_DRIVER = 's3';
    configMock.S3_BUCKET = undefined;
    const { readFileStream } = await import('../../src/services/storage.service.js');
    await expect(readFileStream('t4/x.txt')).rejects.toThrow(/S3_BUCKET/);
  });
});
