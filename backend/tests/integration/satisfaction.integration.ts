import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

/** CSAT — çözümde anket işaretlenir, public puan bir kez kaydedilir, rapora yansır. */

let app: FastifyInstance;
let prisma: PrismaClient;
let auth: { authorization: string };
let ticketId: string;
let accessToken: string;

beforeAll(async () => {
  const module = await import('../../src/app.js');
  app = await module.buildApp();
  await app.ready();
  prisma = (await import('../../src/db.js')).prisma;
  const token = (await app.inject({ method: 'POST', url: '/auth/staff/login', payload: { email: 'admin@company.com', password: 'admin123' } })).json().data.accessToken;
  auth = { authorization: `Bearer ${token}` };

  const category = await prisma.category.findFirstOrThrow({ where: { companyId: { not: null }, isActive: true }, include: { company: { include: { locations: true } } } });
  await prisma.company.update({ where: { id: category.companyId! }, data: { slaSettings: { satisfactionSurvey: true } } });
  const domain = ((category.company!.allowedDomains as string[])[0]) ?? 'example.com';
  const created = await app.inject({
    method: 'POST', url: '/tickets',
    payload: {
      companyId: category.companyId, locationId: category.company!.locations[0].id, categoryId: category.id,
      email: `csat-${Date.now()}@${domain}`, fullName: 'CSAT Test', phone: '05551112233',
      subject: 'Memnuniyet testi', description: 'Çözümden sonra puan verilecek',
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  accessToken = created.json().data.accessToken;
  ticketId = (await prisma.ticket.findUniqueOrThrow({ where: { accessToken } })).id;
});

afterAll(async () => {
  await app.close();
});

describe('memnuniyet anketi — gerçek veritabanı', () => {
  it('açık talep puanlanamaz', async () => {
    const res = await app.inject({ method: 'POST', url: `/public/ticket/${accessToken}/satisfaction`, payload: { rating: 5 } });
    expect(res.statusCode).toBe(400);
  });

  it('çözümde anket bir kez işaretlenir', async () => {
    await app.inject({ method: 'PUT', url: `/tickets/${ticketId}`, headers: auth, payload: { status: 'resolved' } });
    const first = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(first.surveySentAt).toBeInstanceOf(Date);
    await app.inject({ method: 'PUT', url: `/tickets/${ticketId}`, headers: auth, payload: { status: 'closed' } });
    const second = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(second.surveySentAt).toEqual(first.surveySentAt);
  });

  it('puan bir kez kaydedilir, public sayfada görünür ve rapora yansır', async () => {
    const res = await app.inject({ method: 'POST', url: `/public/ticket/${accessToken}/satisfaction`, payload: { rating: 4, comment: 'Hızlı çözüldü' } });
    expect(res.statusCode, res.body).toBe(200);
    const again = await app.inject({ method: 'POST', url: `/public/ticket/${accessToken}/satisfaction`, payload: { rating: 1 } });
    expect(again.statusCode).toBe(409);

    const pub = await app.inject({ method: 'GET', url: `/public/ticket/${accessToken}` });
    expect(pub.json().data.satisfactionRating).toBe(4);

    const report = await app.inject({ method: 'GET', url: '/reports/satisfaction', headers: auth });
    expect(report.statusCode, report.body).toBe(200);
    const data = report.json().data;
    expect(data.count).toBeGreaterThanOrEqual(1);
    expect(data.distribution.find((d: { rating: number }) => d.rating === 4).count).toBeGreaterThanOrEqual(1);
    expect(data.recentComments).toEqual(expect.arrayContaining([expect.objectContaining({ comment: 'Hızlı çözüldü', rating: 4 })]));
  });

  it('veritabanı 1–5 dışını reddeder', async () => {
    await expect(prisma.ticket.update({ where: { id: ticketId }, data: { satisfactionRating: 9 } })).rejects.toThrow();
  });
});
