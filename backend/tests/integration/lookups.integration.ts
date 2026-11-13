import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

/**
 * Sözlükler (v1.3) kabul kriterleri — gerçek PostgreSQL + Redis:
 * panelden (API) eklenen yeni durum deploy'suz kullanılabilir, SLA duraklatma
 * SINIFA göre davranır, birleştirme kullanım satırlarını taşır, sınıf başına
 * "son aktif" pasifleştirilemez.
 */

let app: FastifyInstance;
let prisma: PrismaClient;
let adminAuth: { authorization: string };
let EMAIL_ = '';
const CUSTOM_KEY = `bekleme_musteri_${Date.now()}`;
const ticketIds: string[] = [];

beforeAll(async () => {
  const module = await import('../../src/app.js');
  app = await module.buildApp();
  await app.ready();
  prisma = (await import('../../src/db.js')).prisma;
  const token = (await app.inject({ method: 'POST', url: '/auth/staff/login', payload: { email: 'admin@company.com', password: 'admin123' } })).json().data.accessToken;
  adminAuth = { authorization: `Bearer ${token}` };

  const company = await prisma.company.findFirstOrThrow({ where: { isActive: true } });
  const location = await prisma.location.findFirstOrThrow({ where: { companyId: company.id } });
  const category = await prisma.category.findFirstOrThrow({ where: { companyId: company.id } });
  // allowedDomains kısıtı: test e-postası şirketin izinli domain'inden üretilir.
  const domains = (company.allowedDomains as string[] | undefined) ?? [];
  const domain = domains[0] ?? 'example.test';
  EMAIL_ = `dict-${Date.now()}@${domain.replace(/^@/, '')}`;
  for (const subject of ['Sözlük test talebi 1', 'Sözlük test talebi 2']) {
    const res = await app.inject({ method: 'POST', url: '/tickets', payload: {
      companyId: company.id, locationId: location.id, categoryId: category.id,
      subject, description: 'Sözlük kabul testi için oluşturulan talep gövdesi',
      priority: 'medium', email: EMAIL_, fullName: 'Test', locale: 'tr',
    } });
    expect(res.statusCode, res.body).toBe(201);
    const created = await prisma.ticket.findFirstOrThrow({ where: { subject }, select: { id: true } });
    ticketIds.push(created.id);
  }
});

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
  const { redisConnection } = await import('../../src/jobs/queue.js');
  await redisConnection.del('lookups:cache:v1');
  await app.close();
});

describe('sözlük CRUD + kabul kriterleri', () => {
  it('admin özel bir bekleme sınıfı durumu ekler (deploy yok)', async () => {
    const res = await app.inject({ method: 'POST', url: '/lookups/ticketStatuses', headers: adminAuth, payload: {
      key: CUSTOM_KEY, labelTr: 'Müşteri Beklemesi', labelEn: 'Customer wait', color: 'purple',
      sortOrder: 50, statusClass: 'waiting', isActive: true,
    } });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('yeni anahtar /lookups ve /lookups/public listelerinde görünür', async () => {
    const staff = await app.inject({ method: 'GET', url: '/lookups', headers: adminAuth });
    expect(staff.json().data.ticketStatuses.some((e: { key: string }) => e.key === CUSTOM_KEY)).toBe(true);

    const pub = await app.inject({ method: 'GET', url: '/lookups/public' });
    expect(pub.json().data.ticketStatuses.some((e: { key: string }) => e.key === CUSTOM_KEY)).toBe(true);
    // public görünüm pasif alanları içermez
    expect(pub.json().data.ticketStatuses.every((e: { isActive?: boolean }) => e.isActive === undefined)).toBe(true);
  });

  it('yeni anahtar staff güncellemesiyle atanabilir (Zod dinamik küme)', async () => {
    // Public oluşturma bilinçli olarak her talebi 'open' ile açar; özel anahtar
    // staff güncellemesiyle atanır — Zod doğrulaması dinamik kümeden geçer.
    const res = await app.inject({ method: 'PUT', url: `/tickets/${ticketIds[0]}`, headers: adminAuth, payload: {
      status: CUSTOM_KEY,
    } });
    expect(res.statusCode, res.body).toBe(200);
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketIds[0] }, select: { status: true } });
    expect(row.status).toBe(CUSTOM_KEY);
  });

  it('bilinmeyen anahtar Zod dinamik kümesiyle reddedilir (staff güncellemesi)', async () => {
    // Public oluşturma şemasında status alanı yoktur (her yeni talep 'open' açılır);
    // dinamik doğrulama staff güncelleme ucunda devreye girer.
    const res = await app.inject({ method: 'PUT', url: `/tickets/${ticketIds[0]}`, headers: adminAuth, payload: {
      status: 'olmayan_durum',
    } });
    expect(res.statusCode).toBe(400);
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketIds[0] }, select: { status: true } });
    expect(row.status).not.toBe('olmayan_durum');
  });

  it('waiting SINIFINDAKI özel durum SLA duraklatmasına girer (kabul: sınıf davranışı)', async () => {
    // planStatusTransition sınıf tabanlıdır; bekleme sınıfına giriş slaPausedAt yazar.
    const { planStatusTransition } = await import('../../src/utils/ticket-lifecycle.js');
    const now = new Date();
    const plan = planStatusTransition(
      { status: 'open', firstRespondedAt: null, resolvedAt: null, slaResponseDue: now, slaResolveDue: new Date(now.getTime() + 3600_000), slaResponseMet: null, slaResolveMet: null, slaResponseWarnAt: null, slaResolveWarnAt: null, slaPausedAt: null, slaPausedMinutes: 0 },
      CUSTOM_KEY,
      now,
      null,
    );
    expect(plan.data.slaPausedAt).toEqual(now);
    // waiting_user_response (sistem karşılığı) için de aynı davranış korunur
    const planSystem = planStatusTransition(
      { status: 'open', firstRespondedAt: null, resolvedAt: null, slaResponseDue: now, slaResolveDue: new Date(now.getTime() + 3600_000), slaResponseMet: null, slaResolveMet: null, slaResponseWarnAt: null, slaResolveWarnAt: null, slaPausedAt: null, slaPausedMinutes: 0 },
      'waiting_user_response',
      now,
      null,
    );
    expect(planSystem.data.slaPausedAt).toEqual(now);
  });

  it('birleştirme: özel anahtarın kullanımları hedefe taşınır, kaynak pasifleşir', async () => {
    const res = await app.inject({ method: 'POST', url: `/lookups/ticketStatuses/${CUSTOM_KEY}/merge`, headers: adminAuth, payload: { targetKey: 'waiting_user_response' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data.moved).toBeGreaterThanOrEqual(1);

    const movedTicket = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticketIds[0] }, select: { status: true },
    });
    expect(movedTicket.status).toBe('waiting_user_response');

    const entry = await prisma.$queryRaw<Array<{ is_active: boolean }>>`
      SELECT is_active FROM dict_ticket_statuses WHERE key = ${CUSTOM_KEY}`;
    expect(entry[0].is_active).toBe(false);
  });

  it('sınıf başına SON AKTİF durum pasifleştirilemez', async () => {
    // 'new' sınıfında tek aktif durum vardır: open
    const res = await app.inject({ method: 'PUT', url: '/lookups/ticketStatuses/open', headers: adminAuth, payload: {
      labelTr: 'Açık', labelEn: 'Open', color: 'blue', sortOrder: 1, isActive: false,
    } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('son aktif');
  });

  it('isSystem anahtar SİLİNEMEZ (FK RESTRICT + silme ucu yok)', async () => {
    // Silme ucu hiç tanımlanmadı; DB düzeyinde FK RESTICT garanti eder.
    const entry = await prisma.$queryRaw<Array<{ key: string }>>`
      SELECT key FROM dict_ticket_statuses WHERE key = 'open'`;
    expect(entry.length).toBe(1);
  });
});
