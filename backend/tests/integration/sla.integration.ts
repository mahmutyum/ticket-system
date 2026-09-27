import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Prisma, type PrismaClient } from '@prisma/client';

/**
 * SLA duraklatma, şirket SLA ayarları ve otomatik kapatmanın gerçek PostgreSQL
 * üzerinde uçtan uca doğrulanması (JSON kolonu, @db.Date, yeni indeksler).
 */

let app: FastifyInstance;
let prisma: PrismaClient;
let token: string;
let companyId: string;
let ticketId: string;

const auth = () => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  const module = await import('../../src/app.js');
  app = await module.buildApp();
  await app.ready();
  prisma = (await import('../../src/db.js')).prisma;

  const login = await app.inject({
    method: 'POST', url: '/auth/staff/login',
    payload: { email: 'admin@company.com', password: 'admin123' },
  });
  token = login.json().data.accessToken;

  // SLA'lı bir kategorisi olan şirket.
  const category = await prisma.category.findFirstOrThrow({
    where: { slaResponseMinutes: { gt: 0 }, slaResolutionMinutes: { gt: 0 }, companyId: { not: null }, isActive: true },
    include: { company: { include: { locations: true } } },
  });
  companyId = category.companyId!;
  // Tekrar çalıştırılabilirlik: önceki koşunun tatil ve SLA ayarlarını temizle
  // (7/24 varsayılan; mesai takvimi açık kalırsa hafta sonu kaydırma 0 olur).
  await prisma.companyHoliday.deleteMany({ where: { companyId } });
  await prisma.company.update({ where: { id: companyId }, data: { slaSettings: Prisma.DbNull } });
  const domains = (category.company!.allowedDomains as string[]) ?? [];
  const email = `sla-it@${domains[0] ?? 'example.com'}`;

  const created = await app.inject({
    method: 'POST', url: '/tickets',
    payload: {
      companyId, locationId: category.company!.locations[0].id, categoryId: category.id,
      email, fullName: 'SLA Test', phone: '05551112233',
      subject: 'SLA entegrasyon testi', description: 'Duraklatma ve otomatik kapatma akışı',
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const ticket = await prisma.ticket.findUniqueOrThrow({ where: { ticketNumber: created.json().data.ticketNumber } });
  ticketId = ticket.id;
});

afterAll(async () => {
  await app.close();
});

describe('SLA — gerçek veritabanı', () => {
  it('yeni ticket son tarih, uyarı anı ve durum değişim anıyla açılır', async () => {
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(t.slaResolveDue).toBeInstanceOf(Date);
    expect(t.slaResolveWarnAt!.getTime()).toBeLessThan(t.slaResolveDue!.getTime());
    expect(t.statusChangedAt).toBeInstanceOf(Date);
  });

  it('yanıt bekleniyor → SLA duraklar; işlemde → son tarih ileri kayar', async () => {
    const before = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    const wait = await app.inject({ method: 'PUT', url: `/tickets/${ticketId}`, headers: auth(), payload: { status: 'waiting_user_response' } });
    expect(wait.statusCode, wait.body).toBe(200);
    const paused = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(paused.slaPausedAt).toBeInstanceOf(Date);
    expect(paused.firstRespondedAt).toBeInstanceOf(Date);

    // Duraklatmayı 2 saat önceye çek (zamanı beklemeden kaydırmayı gözlemlemek için).
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await prisma.ticket.update({ where: { id: ticketId }, data: { slaPausedAt: twoHoursAgo } });

    const resume = await app.inject({ method: 'PUT', url: `/tickets/${ticketId}`, headers: auth(), payload: { status: 'in_progress' } });
    expect(resume.statusCode, resume.body).toBe(200);
    const resumed = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(resumed.slaPausedAt).toBeNull();
    expect(resumed.slaPausedMinutes).toBeGreaterThanOrEqual(119);
    const shiftMinutes = (resumed.slaResolveDue!.getTime() - before.slaResolveDue!.getTime()) / 60_000;
    expect(shiftMinutes).toBeGreaterThanOrEqual(119);

    const actions = (await prisma.ticketHistory.findMany({ where: { ticketId }, select: { action: true } })).map(h => h.action);
    expect(actions).toEqual(expect.arrayContaining(['sla_paused', 'sla_resumed']));
  });

  it('şirket SLA ayarları ve tatil günleri kaydedilir', async () => {
    const put = await app.inject({
      method: 'PUT', url: `/companies/${companyId}/sla`, headers: auth(),
      payload: {
        businessHours: { enabled: true, timezone: 'Europe/Istanbul', week: { mon: [{ start: '09:00', end: '18:00' }] } },
        alwaysOnPriorities: ['critical'],
        warningPercent: 70,
        escalation: { notifyManagers: true, bumpPriority: false },
        autoClose: { resolvedAfterDays: 3, waitingReminderAfterDays: 0, waitingCloseAfterDays: 0 },
      },
    });
    expect(put.statusCode, put.body).toBe(200);

    const add = await app.inject({ method: 'POST', url: `/companies/${companyId}/holidays`, headers: auth(), payload: { date: '2026-10-29', name: 'Cumhuriyet Bayramı' } });
    expect(add.statusCode, add.body).toBe(201);
    const dup = await app.inject({ method: 'POST', url: `/companies/${companyId}/holidays`, headers: auth(), payload: { date: '2026-10-29', name: 'Tekrar' } });
    expect(dup.statusCode).toBe(409);

    const copy = await app.inject({ method: 'POST', url: `/companies/${companyId}/holidays/copy-year`, headers: auth(), payload: { fromYear: 2026, toYear: 2027 } });
    expect(copy.json().data.created).toBe(1);

    const get = await app.inject({ method: 'GET', url: `/companies/${companyId}/sla`, headers: auth() });
    expect(get.json().data.settings.warningPercent).toBe(70);
    expect(get.json().data.holidays.map((h: { date: string }) => h.date)).toEqual(['2026-10-29', '2027-10-29']);
  });

  it('çözülen ticket şirket süresi dolunca otomatik kapanır', async () => {
    const resolve = await app.inject({ method: 'PUT', url: `/tickets/${ticketId}`, headers: auth(), payload: { status: 'resolved' } });
    expect(resolve.statusCode, resolve.body).toBe(200);
    // Çözülme anını 4 gün önceye çek (şirket ayarı: 3 gün).
    await prisma.ticket.update({ where: { id: ticketId }, data: { statusChangedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) } });

    const { runAutoClose } = await import('../../src/jobs/auto-close.js');
    const emails: string[] = [];
    await runAutoClose(prisma, new Date(), {
      queueEmail: async (data) => { emails.push(data.templateSlug); },
      broadcastStaff: () => undefined,
      broadcastTicket: () => undefined,
    });

    const closed = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(closed.status).toBe('closed');
    expect(closed.closedAt).toBeInstanceOf(Date);
    expect(emails).toContain('ticket_auto_closed');
  });

  it('SLA turu gerçek sorgularla çalışır', async () => {
    const { runSlaCheck } = await import('../../src/jobs/sla-check.js');
    const result = await runSlaCheck(prisma, new Date(), { queueEmail: async () => undefined, broadcast: () => undefined });
    expect(result).toMatchObject({ warnings: expect.any(Number), breaches: expect.any(Number) });
  });
});
