import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';

/**
 * Webhook uçtan uca: gerçek PostgreSQL, yerel HTTP alıcı. Alıcı 127.0.0.1'de olduğu
 * için yalnızca SSRF denetimi bu testte devre dışıdır.
 */
vi.mock('../../src/utils/net-guard.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/utils/net-guard.js')>();
  return { ...original, assertIntegrationHost: async () => undefined };
});

let app: FastifyInstance;
let prisma: PrismaClient;
let auth: { authorization: string };
let receiver: Server;
let receiverUrl: string;
const received: Array<{ headers: Record<string, string | string[] | undefined>; body: string }> = [];
let webhookId: string;
let secret: string;

beforeAll(async () => {
  receiver = createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.writeHead(204).end();
    });
  });
  await new Promise<void>(r => receiver.listen(0, '127.0.0.1', r));
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;

  const module = await import('../../src/app.js');
  app = await module.buildApp();
  await app.ready();
  prisma = (await import('../../src/db.js')).prisma;
  const token = (await app.inject({ method: 'POST', url: '/auth/staff/login', payload: { email: 'admin@company.com', password: 'admin123' } })).json().data.accessToken;
  auth = { authorization: `Bearer ${token}` };
});

afterAll(async () => {
  if (webhookId) await prisma.webhook.deleteMany({ where: { id: webhookId } });
  await app.close();
  await new Promise(r => receiver.close(r));
});

describe('webhook — gerçek veritabanı', () => {
  it('oluşturulur; sır yalnızca bir kez döner, URL listede görünmez', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhooks', headers: auth,
      payload: { name: 'n8n', kind: 'generic', url: receiverUrl, events: ['ticket.created', 'ticket.status_changed'] },
    });
    expect(res.statusCode, res.body).toBe(200);
    webhookId = res.json().data.id;
    secret = res.json().data.secret;
    expect(secret).toMatch(/^whsec_/);
    const list = await app.inject({ method: 'GET', url: '/webhooks', headers: auth });
    expect(list.body).not.toContain(secret);
    expect(list.body).not.toContain('/hook');
  });

  it('test bildirimi alıcıya imzalı ulaşır', async () => {
    const res = await app.inject({ method: 'POST', url: `/webhooks/${webhookId}/test`, headers: auth });
    expect(res.json().data).toMatchObject({ status: 'success', statusCode: 204 });
    const last = received.at(-1)!;
    const expected = createHmac('sha256', secret).update(`${String(last.headers['x-ticket-timestamp'])}.${last.body}`).digest('hex');
    expect(last.headers['x-ticket-signature']).toBe(`sha256=${expected}`);
    expect(JSON.parse(last.body)).toMatchObject({ event: 'ping' });
  });

  it('ticket oluşturma olayı teslimat kaydı açar ve teslim edilir', async () => {
    const category = await prisma.category.findFirstOrThrow({ where: { companyId: { not: null }, isActive: true }, include: { company: { include: { locations: true } } } });
    const domain = ((category.company!.allowedDomains as string[])[0]) ?? 'example.com';
    const created = await app.inject({
      method: 'POST', url: '/tickets',
      payload: {
        companyId: category.companyId, locationId: category.company!.locations[0].id, categoryId: category.id,
        email: `hook-${Date.now()}@${domain}`, fullName: 'Webhook Test', phone: '05551112233',
        subject: 'Webhook olay testi', description: 'Oluşturma olayı dış sisteme gitmeli',
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const delivery = await prisma.webhookDelivery.findFirstOrThrow({ where: { webhookId, event: 'ticket.created' }, orderBy: { createdAt: 'desc' } });
    const { deliverWebhook } = await import('../../src/services/webhooks/dispatch.js');
    await deliverWebhook(prisma, delivery.id);
    const body = JSON.parse(received.at(-1)!.body);
    expect(body).toMatchObject({ event: 'ticket.created', ticket: { number: created.json().data.ticketNumber, status: 'open' } });
    // Talep sahibinin bearer bağlantısı dışarı gitmez.
    expect(received.at(-1)!.body).not.toContain(created.json().data.accessToken);
  });
});
