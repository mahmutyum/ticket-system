import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

/** Birleştirme, üst/alt ticket ve izleyiciler — gerçek PostgreSQL üzerinde. */

let app: FastifyInstance;
let prisma: PrismaClient;
let token: string;
const ids: Record<string, string> = {};
const auth = () => ({ authorization: `Bearer ${token}` });

async function openTicket(label: string, email: string, base: { companyId: string; locationId: string; categoryId: string }) {
  const res = await app.inject({
    method: 'POST', url: '/tickets',
    payload: { ...base, email, fullName: `Kişi ${label}`, phone: '05551112233', subject: `İlişki testi ${label}`, description: 'Aynı arıza farklı kişilerden' },
  });
  expect(res.statusCode, res.body).toBe(201);
  const ticket = await prisma.ticket.findUniqueOrThrow({ where: { ticketNumber: res.json().data.ticketNumber } });
  ids[label] = ticket.id;
}

beforeAll(async () => {
  const module = await import('../../src/app.js');
  app = await module.buildApp();
  await app.ready();
  prisma = (await import('../../src/db.js')).prisma;
  token = (await app.inject({ method: 'POST', url: '/auth/staff/login', payload: { email: 'admin@company.com', password: 'admin123' } })).json().data.accessToken;

  const category = await prisma.category.findFirstOrThrow({
    where: { companyId: { not: null }, isActive: true },
    include: { company: { include: { locations: true } } },
  });
  const domain = ((category.company!.allowedDomains as string[])[0]) ?? 'example.com';
  const base = { companyId: category.companyId!, locationId: category.company!.locations[0].id, categoryId: category.id };
  const stamp = Date.now();
  await openTicket('src', `rel-a-${stamp}@${domain}`, base);
  await openTicket('dst', `rel-b-${stamp}@${domain}`, base);
  await openTicket('parent', `rel-c-${stamp}@${domain}`, base);
  await openTicket('child', `rel-d-${stamp}@${domain}`, base);
});

afterAll(async () => {
  await app.close();
});

describe('ticket ilişkileri — gerçek veritabanı', () => {
  it('birleştirme notları taşır, kaynağı kapatır, kaynağın sahibini hedefe CC ekler', async () => {
    await app.inject({ method: 'POST', url: `/tickets/${ids.src}/notes`, headers: auth(), payload: { content: 'Kaynaktaki not', isInternal: true } });
    const res = await app.inject({ method: 'POST', url: `/tickets/${ids.src}/merge`, headers: auth(), payload: { targetId: ids.dst } });
    expect(res.statusCode, res.body).toBe(200);

    const src = await prisma.ticket.findUniqueOrThrow({ where: { id: ids.src } });
    expect(src).toMatchObject({ status: 'closed', mergedIntoId: ids.dst });
    expect(await prisma.ticketNote.count({ where: { ticketId: ids.dst, content: 'Kaynaktaki not' } })).toBe(1);
    expect(await prisma.ticketWatcher.count({ where: { ticketId: ids.dst, email: src.createdByEmail.toLowerCase() } })).toBe(1);

    const detail = await app.inject({ method: 'GET', url: `/tickets/${ids.dst}`, headers: auth() });
    expect(detail.json().data.mergedFrom).toEqual([expect.objectContaining({ id: ids.src })]);

    const again = await app.inject({ method: 'POST', url: `/tickets/${ids.src}/merge`, headers: auth(), payload: { targetId: ids.dst } });
    expect(again.statusCode).toBe(400);
  });

  it('üst ticket çözülünce alt ticket\'lar da çözülür (applyToChildren)', async () => {
    const link = await app.inject({ method: 'PUT', url: `/tickets/${ids.child}/parent`, headers: auth(), payload: { parentId: ids.parent } });
    expect(link.statusCode, link.body).toBe(200);
    const res = await app.inject({ method: 'PUT', url: `/tickets/${ids.parent}`, headers: auth(), payload: { status: 'resolved', applyToChildren: true } });
    expect(res.statusCode, res.body).toBe(200);
    const child = await prisma.ticket.findUniqueOrThrow({ where: { id: ids.child } });
    expect(child.status).toBe('resolved');
    expect(child.resolvedAt).toBeInstanceOf(Date);
  });
});
