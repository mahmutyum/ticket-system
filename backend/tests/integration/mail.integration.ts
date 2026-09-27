import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { MailSource } from '../../src/services/mail/sources.js';

/**
 * E-postayla yanıt — gerçek PostgreSQL üzerinde: posta kutusu kaydı, yanıtın
 * ticket geçmişine düşmesi, tekilleştirme ve eşleşmeyenden ticket açılması.
 * Posta sağlayıcısı sahte bir kaynakla temsil edilir.
 */

let app: FastifyInstance;
let prisma: PrismaClient;
let token: string;
let companyId: string;
let ticket: { id: string; ticketNumber: string; createdByEmail: string };
const MAILBOX = 'inbound-it@example.com';

const auth = () => ({ authorization: `Bearer ${token}` });
const noop = async () => undefined;
const deps = { queueEmail: noop, queueSms: noop, broadcastStaff: () => undefined };

function sourceWith(raws: string[]): { source: MailSource; marked: string[] } {
  const marked: string[] = [];
  return {
    marked,
    source: {
      fetchUnread: async () => raws.map((raw, i) => ({ id: String(i), raw: Buffer.from(raw.replace(/\n/g, '\r\n')) })),
      markProcessed: async (id) => { marked.push(id); },
      close: noop,
    },
  };
}

beforeAll(async () => {
  const module = await import('../../src/app.js');
  app = await module.buildApp();
  await app.ready();
  prisma = (await import('../../src/db.js')).prisma;

  const login = await app.inject({ method: 'POST', url: '/auth/staff/login', payload: { email: 'admin@company.com', password: 'admin123' } });
  token = login.json().data.accessToken;

  // Kendi ticket'ını portal üzerinden açar (seed ticket içermez).
  const category = await prisma.category.findFirstOrThrow({
    where: { companyId: { not: null }, isActive: true },
    include: { company: { include: { locations: true } } },
  });
  companyId = category.companyId!;
  const domain = ((category.company!.allowedDomains as string[])[0]) ?? 'example.com';
  const created = await app.inject({
    method: 'POST', url: '/tickets',
    payload: {
      companyId, locationId: category.company!.locations[0].id, categoryId: category.id,
      email: `mail-it-${Date.now()}@${domain}`, fullName: 'Mail Test', phone: '05551112233',
      subject: 'E-posta entegrasyon testi', description: 'Yanıtın e-postayla gelmesi',
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  ticket = await prisma.ticket.findUniqueOrThrow({ where: { ticketNumber: created.json().data.ticketNumber } });
  await prisma.companyMailbox.deleteMany({ where: { OR: [{ companyId }, { address: MAILBOX }] } });
});

afterAll(async () => {
  await prisma.companyMailbox.deleteMany({ where: { companyId } });
  await app.close();
});

describe('e-postayla yanıt — gerçek veritabanı', () => {
  it('posta kutusu kaydedilir, sır dönmez', async () => {
    const category = await prisma.category.findFirstOrThrow({ where: { companyId } });
    const location = await prisma.location.findFirstOrThrow({ where: { companyId } });
    const res = await app.inject({
      method: 'PUT', url: `/companies/${companyId}/mailbox`, headers: auth(),
      payload: {
        provider: 'microsoft365', address: MAILBOX, tenantId: 'tenant', clientId: 'client', secret: 'client-secret',
        createTickets: true, defaultCategoryId: category.id, defaultLocationId: location.id, defaultLocale: 'en',
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain('client-secret');
    expect(res.json().data.mailbox).toMatchObject({ hasSecret: true, createTickets: true });
  });

  it('talep sahibinin yanıtı ticket geçmişine düşer; aynı ileti ikinci kez işlenmez', async () => {
    const { runMailFetch } = await import('../../src/jobs/mail-fetch.js');
    const raw = `From: ${ticket.createdByEmail}\nTo: ${MAILBOX}\nSubject: Re: ${ticket.ticketNumber}\nMessage-ID: <reply-${ticket.id}@example.com>\n\nE-postayla yanıt\n\nOn Mon, IT wrote:\n> eski`;

    const first = sourceWith([raw]);
    const summary = await runMailFetch(prisma, new Date(), { ...deps, createSource: () => first.source });
    expect(summary.processed).toBe(1);
    expect(first.marked).toEqual(['0']);

    const history = await prisma.ticketHistory.findFirstOrThrow({ where: { ticketId: ticket.id, action: 'user_reply' }, orderBy: { createdAt: 'desc' } });
    expect(history).toMatchObject({ field: 'email', newValue: 'E-postayla yanıt' });

    const second = sourceWith([raw]);
    const again = await runMailFetch(prisma, new Date(), { ...deps, createSource: () => second.source });
    expect(again.processed).toBe(0);
    expect(second.marked).toEqual(['0']);

    const log = await prisma.inboundMessage.findMany({ where: { messageId: `<reply-${ticket.id}@example.com>` } });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: 'reply', ticketId: ticket.id });
  });

  it('eşleşmeyen e-postadan email kaynaklı ticket açılır', async () => {
    const { runMailFetch } = await import('../../src/jobs/mail-fetch.js');
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const domain = ((company.allowedDomains as string[])[0]) ?? 'example.com';
    const unique = Date.now();
    const raw = `From: New Person <new.person.${unique}@${domain}>\nTo: ${MAILBOX}\nSubject: Fwd: VPN does not connect\nMessage-ID: <new-${unique}@example.com>\n\nThe VPN client keeps disconnecting.`;
    const { source } = sourceWith([raw]);
    await runMailFetch(prisma, new Date(), { ...deps, createSource: () => source });

    const created = await prisma.ticket.findFirstOrThrow({ where: { createdByEmail: `new.person.${unique}@${domain}` } });
    expect(created).toMatchObject({ source: 'email', subject: 'VPN does not connect', locale: 'en', companyId });
  });
});
