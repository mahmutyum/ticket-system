import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';

/**
 * "Taleplerim" (v1.3) — gerçek PostgreSQL + Redis:
 * e-posta sahipliği akışı, listeleme, token süresi dolunca 404, enumeration
 * sızıntısı OLMAMASI ve mail kuyruğuna doğru şablonla iş bırakılması.
 */

let app: FastifyInstance;
let prisma: PrismaClient;
let emailQueue: Queue;
let companyId: string;
let locationId: string;
let categoryId: string;
const ticketIds: string[] = [];
let EMAIL_ = '';

beforeAll(async () => {
  const module = await import('../../src/app.js');
  app = await module.buildApp();
  await app.ready();
  prisma = (await import('../../src/db.js')).prisma;
  emailQueue = new Queue('email', { connection: (await import('../../src/jobs/queue.js')).redisConnection });

  const company = await prisma.company.findFirstOrThrow({ where: { isActive: true } });
  companyId = company.id;
  const location = await prisma.location.findFirstOrThrow({ where: { companyId } });
  locationId = location.id;
  const category = await prisma.category.findFirstOrThrow({ where: { companyId } });
  categoryId = category.id;
  // Public /tickets, şirketin allowedDomains kısıtına tabidir — test e-postası
  // izinli domain'den üretilir (kısıt boşsa ör. example.test kullanılır).
  const domains = (company.allowedDomains as string[] | undefined) ?? [];
  const domain = domains[0] ?? 'example.test';
  EMAIL_ = `my-tickets-${Date.now()}@${domain.replace(/^@/, '')}`;
});

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
  // my-tickets:* anahtarlarını temizle
  const keys = await (await import('../../src/jobs/queue.js')).redisConnection.keys('my-tickets:*');
  if (keys.length > 0) await (await import('../../src/jobs/queue.js')).redisConnection.del(...keys);
  await emailQueue.close();
  await app.close();
});

async function createTicket(subject: string): Promise<void> {
  const res = await app.inject({ method: 'POST', url: '/tickets', payload: {
    companyId, locationId, categoryId, subject,
    description: 'Entegrasyon testi için oluşturulan talep gövdesi',
    priority: 'medium', email: EMAIL_, fullName: 'Test', locale: 'tr',
  } });
  expect(res.statusCode, res.body).toBe(201);
  const id = res.json().data.ticketNumber; // yalnızca takip için; gerçek id accessToken ile gelir
  void id;
  const created = await prisma.ticket.findFirstOrThrow({ where: { subject }, select: { id: true } });
  ticketIds.push(created.id);
}

let knownToken = '';

/** EMAIL_ için üretilen token'ı Redis'ten seçer (bilinmeyen adrenkinkiyle karışmaz). */
async function knownEmailToken(): Promise<string> {
  const redis = (await import('../../src/jobs/queue.js')).redisConnection;
  const keys = await redis.keys('my-tickets:*');
  expect(keys.length, 'my-tickets anahtarı üretilmeli').toBeGreaterThan(0);
  for (const key of keys) {
    const value = JSON.parse(await redis.get(key) as string) as { email: string };
    if (value.email === EMAIL_) return key.replace('my-tickets:', '');
  }
  throw new Error('EMAIL_ için token bulunamadı');
}

describe('POST /public/my-tickets/link', () => {
  it('bilinen/bilinmeyen adrese AYNI genel yanıtı verir ve mail kuyruklar (enumeration yok)', async () => {
    await createTicket('Yazıcı arızası');
    await createTicket('VPN bağlantı sorunu');

    const known = await app.inject({ method: 'POST', url: '/public/my-tickets/link', payload: { email: EMAIL_, locale: 'en' } });
    expect(known.statusCode).toBe(200);
    expect(known.json()).toEqual({ success: true });

    const unknown = await app.inject({ method: 'POST', url: '/public/my-tickets/link', payload: { email: `yok-${Date.now()}@example.test`, locale: 'tr' } });
    // Bilinmeyen adres de aynı genel yanıtı alır — adres taraması yapılamaz.
    expect(unknown.json()).toEqual({ success: true });

    // Kuyruğa alınan mailler: istekteki dil + doğru şablon.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const jobs = await emailQueue.getJobs(['waiting', 'active', 'delayed'], 0, 50);
    const mine = jobs.filter((j) => j?.data?.to === EMAIL_);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine[0].data.templateSlug).toBe('my_tickets_link');
    expect(mine[0].data.locale).toBe('en');
    expect(mine[0].data.variables.ticketCount).toBe('2');
    knownToken = await knownEmailToken();
  });

  it('geçersiz e-posta 400 döner', async () => {
    const res = await app.inject({ method: 'POST', url: '/public/my-tickets/link', payload: { email: 'geçersiz' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /public/my-tickets/:token', () => {
  it('token ile e-postaya ait tüm talepler accessToken ile listelenir', async () => {
    await createTicket('İkinci yazıcı arızası');
    const token = knownToken;
    const res = await app.inject({ method: 'GET', url: `/public/my-tickets/${token}` });
    expect(res.statusCode).toBe(200);
    const { email, tickets } = res.json().data;
    expect(email).toBe(EMAIL_);
    expect(tickets.length).toBe(3);
    for (const ticket of tickets) {
      expect(ticket.accessToken).toBeTruthy();
      expect(ticket.company.name).toBeTruthy();
    }
    // En yeni en üstte
    expect(tickets[0].subject).toBe('İkinci yazıcı arızası');
  });

  it('süresi dolmuş/geçersiz token 404 döner', async () => {
    const res = await app.inject({ method: 'GET', url: '/public/my-tickets/olmayan-token-1234567890' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBeTruthy();
  });
});
