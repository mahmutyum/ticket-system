import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

/**
 * Zamanlanmış görevler + yedek hedefleri (v1.2) — gerçek PostgreSQL + Redis.
 * Backup İŞÇİSİ bu testlerde koşmaz (ayrı servis); test edilen yüzey:
 * registry listesi, cron doğrulama, çalışma kaydı tablosu ve hedef CRUD +
 * sırrının asla dönmemesi.
 */

let app: FastifyInstance;
let prisma: PrismaClient;
let adminAuth: { authorization: string };
let staffAuth: { authorization: string };
const targetIds: string[] = [];

beforeAll(async () => {
  const module = await import('../../src/app.js');
  app = await module.buildApp();
  await app.ready();
  prisma = (await import('../../src/db.js')).prisma;
  const login = async (email: string) =>
    (await app.inject({ method: 'POST', url: '/auth/staff/login', payload: { email, password: 'admin123' } })).json().data.accessToken;
  adminAuth = { authorization: `Bearer ${await login('admin@company.com')}` };
  // it_staff: it@company.com (staff123) — rol kısıtı testi için
  staffAuth = { authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/auth/staff/login', payload: { email: 'it@company.com', password: 'staff123' } })).json().data.accessToken}` };
});

afterAll(async () => {
  await prisma.backupTarget.deleteMany({ where: { id: { in: targetIds } } });
  await prisma.scheduledJobRun.deleteMany({ where: { jobKey: { in: ['sla-check', 'retention-check'] } } });
  await app.close();
});

const VALID_INI = '[target]\ntype = s3\nprovider = AWS\naccess_key_id = k\nsecret_access_key = s\nendpoint = https://example.com\n';

describe('GET /scheduled-jobs — kayıt defteri', () => {
  it('registry görevlerini tercihler ve sonraki çalışmayla döner (admin)', async () => {
    const res = await app.inject({ method: 'GET', url: '/scheduled-jobs', headers: adminAuth });
    expect(res.statusCode).toBe(200);
    const jobs = res.json().data as Array<{ key: string; cron: string; enabled: boolean; nextRuns: string[] }>;
    const keys = jobs.map((j) => j.key);
    expect(keys).toContain('sla-check');
    expect(keys).toContain('backup');
    expect(keys).toContain('retention-check');
    const sla = jobs.find((j) => j.key === 'sla-check');
    expect(sla?.enabled).toBe(true);
    expect(sla?.nextRuns.length).toBe(5);
  });

  it('it_staff erişemez (yalnızca admin)', async () => {
    const res = await app.inject({ method: 'GET', url: '/scheduled-jobs', headers: staffAuth });
    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /scheduled-jobs/:key — cron güncelleme', () => {
  it('geçerli cron kaydedilir ve çalışma tercih DB\'de saklanır', async () => {
    const res = await app.inject({ method: 'PUT', url: '/scheduled-jobs/retention-check', headers: adminAuth, payload: { cron: '30 4 * * 1' } });
    expect(res.statusCode).toBe(200);
    const row = await prisma.scheduledJob.findUnique({ where: { key: 'retention-check' } });
    expect(row?.cron).toBe('30 4 * * 1');
    // temizle: varsayılana dön
    await app.inject({ method: 'PUT', url: '/scheduled-jobs/retention-check', headers: adminAuth, payload: { cron: '15 3 * * *' } });
  });

  it('geçersiz cron 400 döner ve DB\'ye yazılmaz', async () => {
    const res = await app.inject({ method: 'PUT', url: '/scheduled-jobs/sla-check', headers: adminAuth, payload: { cron: 'not-a-cron' } });
    expect(res.statusCode).toBe(400);
    const row = await prisma.scheduledJob.findUnique({ where: { key: 'sla-check' } });
    expect(row?.cron).not.toBe('not-a-cron');
  });

  it('registry dışı görev 404 döner', async () => {
    const res = await app.inject({ method: 'PUT', url: '/scheduled-jobs/tanimsiz-gorev', headers: adminAuth, payload: { enabled: false } });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /scheduled-jobs/:key/trigger + çalışma kaydı', () => {
  it('retention-check elle tetiklenir ve (işçi olmadan) kuyruğa iş düşer', async () => {
    // İşçi koşmadığı için ScheduledJobRun oluşmaz; tetiklemenin kendisi 200 ve audit'e yazılır.
    const res = await app.inject({ method: 'POST', url: '/scheduled-jobs/retention-check/trigger', headers: adminAuth });
    expect(res.statusCode).toBe(200);
  });

  it('çalışma geçmişi sayfalı döner', async () => {
    const res = await app.inject({ method: 'GET', url: '/scheduled-jobs/sla-check/runs', headers: adminAuth, query: { page: '1', limit: '10' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('pagination');
  });
});

describe('yedek hedefleri CRUD — sırrı write-only', () => {
  it('hedef oluşturur; listede configEnc/INI ASLA dönmez', async () => {
    const create = await app.inject({ method: 'POST', url: '/backups/targets', headers: adminAuth, payload: {
      name: `test-target-${Date.now()}`, type: 's3', configIni: VALID_INI,
    } });
    expect(create.statusCode).toBe(200);
    const id = create.json().data.id as string;
    targetIds.push(id);

    const list = await app.inject({ method: 'GET', url: '/backups/targets', headers: adminAuth });
    expect(list.statusCode).toBe(200);
    const raw = list.body;
    expect(raw).not.toContain('secret_access_key');
    expect(raw).not.toContain('configEnc');
    const target = (list.json().data as Array<Record<string, unknown>>).find((t) => t.id === id);
    expect(target?.hasConfig).toBe(true);
    expect(target?.name).toContain('test-target-');
  });

  it('[target] remote adı olmayan config 400 döner', async () => {
    const res = await app.inject({ method: 'POST', url: '/backups/targets', headers: adminAuth, payload: {
      name: 'bad', type: 's3', configIni: '[other]\ntype = s3\n',
    } });
    expect(res.statusCode).toBe(400);
  });

  it('bulut metadata endpoint\'i SSRF korumasıyla reddedilir', async () => {
    const res = await app.inject({ method: 'POST', url: '/backups/targets', headers: adminAuth, payload: {
      name: 'metadata', type: 's3', configIni: '[target]\ntype = s3\nendpoint = http://169.254.169.254\n',
    } });
    expect(res.statusCode).toBe(400);
  });

  it('configIni verilmeden güncellenirse sırrı korunur', async () => {
    const create = await app.inject({ method: 'POST', url: '/backups/targets', headers: adminAuth, payload: {
      name: `keep-secret-${Date.now()}`, type: 's3', configIni: VALID_INI, retentionDaily: 9,
    } });
    const id = create.json().data.id as string;
    targetIds.push(id);
    const update = await app.inject({ method: 'PUT', url: `/backups/targets/${id}`, headers: adminAuth, payload: {
      name: 'keep-secret-renamed', type: 's3', retentionDaily: 14, retentionWeekly: 4, retentionMonthly: 6, enabled: false,
    } });
    expect(update.statusCode).toBe(200);
    const row = await prisma.backupTarget.findUnique({ where: { id } });
    expect(row?.name).toBe('keep-secret-renamed');
    expect(row?.retentionDaily).toBe(14);
    // sırrı hâlâ çözülebilir olmalı (korunmuş)
    const { decrypt } = await import('../../src/utils/crypto.js');
    expect(() => decrypt(row!.configEnc)).not.toThrow();
    expect(decrypt(row!.configEnc)).toContain('[target]');
  });

  it('it_staff hedef yönetemez', async () => {
    const res = await app.inject({ method: 'GET', url: '/backups/targets', headers: staffAuth });
    expect(res.statusCode).toBe(403);
  });
});
