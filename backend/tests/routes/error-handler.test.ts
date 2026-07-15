import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
import { z, ZodError } from 'zod';

/**
 * Global hata handler'ı — SIRA HATASI regresyon testi.
 *
 * `app.setErrorHandler()` route kayıtlarından SONRA çağrılırsa hiçbirine
 * uygulanmaz: `await app.register(...)` çağrıldığı anda child context'i oluşturur
 * ve o an geçerli olan handler'ı yakalar. app.ts'te uzun süre böyleydi — özel
 * handler HİÇ çalışmıyordu:
 *
 *   - Yanıtlar Fastify'ın varsayılan `{statusCode, error, message}` formatındaydı,
 *     API sözleşmesindeki `{success, error}` değil.
 *   - Türkçe mesajlar, production'da 500 detaylarını gizleme ve ZodError→400
 *     eşlemesinin hiçbiri devrede değildi.
 *   - Ham Zod hata dizisi (alan adları, şema yapısı) istemciye dönüyordu.
 *
 * Bu testler davranışı değil, SIRAYI kanıtlar: aynı handler iki farklı sırayla
 * kurulur ve sonuçlar karşılaştırılır.
 */

const schema = z.object({ subject: z.string().min(5, 'Konu en az 5 karakter olmalı') });

function errorHandler(error: FastifyError, _req: unknown, reply: any) {
  if (error instanceof ZodError) {
    return reply.status(400).send({ success: false, error: 'Geçersiz istek' });
  }
  const statusCode = error.statusCode || 500;
  return reply.status(statusCode).send({
    success: false,
    error: statusCode === 500 ? 'Sunucu hatası' : error.message,
  });
}

async function routes(app: any) {
  app.post('/x', async (req: any) => {
    schema.parse(req.body);
    return { success: true };
  });
}

describe('setErrorHandler sırası', () => {
  it('handler route kayıtlarından ÖNCE kurulunca UYGULANIR', async () => {
    const app = Fastify();
    app.setErrorHandler(errorHandler);
    await app.register(routes, { prefix: '/api' });
    await app.ready();

    const res = await app.inject({ method: 'POST', url: '/api/x', payload: { subject: 'a' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ success: false, error: 'Geçersiz istek' });
    await app.close();
  });

  it('handler route kayıtlarından SONRA kurulunca UYGULANMAZ — bu hataya düşme', async () => {
    const app = Fastify();
    await app.register(routes, { prefix: '/api' });
    app.setErrorHandler(errorHandler); // ÇOK GEÇ
    await app.ready();

    const res = await app.inject({ method: 'POST', url: '/api/x', payload: { subject: 'a' } });
    // Fastify'ın varsayılanı devrede: 500 ve farklı gövde şekli.
    expect(res.statusCode).toBe(500);
    expect(res.json()).not.toHaveProperty('success');
    await app.close();
  });
});

describe('gerçek buildApp — handler uygulanıyor mu', () => {
  it('geçersiz gövde 400 ve {success:false} döndürür', async () => {
    // buildApp Postgres/Redis'e bağlanır; burada yalnızca hata handler'ının
    // route'lara ULAŞTIĞINI doğrulamak istiyoruz, o yüzden plugin'ler stub'lanır.
    vi.resetModules();
    vi.doMock('../../src/plugins/prisma.js', () => ({
      prismaPlugin: async (app: any) => app.decorate('prisma', {}),
    }));
    vi.doMock('../../src/plugins/redis.js', () => ({
      redisPlugin: async (app: any) => app.decorate('redis', {}),
    }));
    vi.doMock('../../src/jobs/queue.js', () => ({
      queueEmail: vi.fn(), queueSms: vi.fn(),
    }));

    const { buildApp } = await import('../../src/app.js');
    const app = await buildApp();
    await app.ready();

    // Kimliksiz uç; gövde şemayı ihlal ediyor.
    const res = await app.inject({
      method: 'POST',
      url: '/tickets',
      payload: { subject: 'a' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    // Regresyon: Fastify varsayılanı olsaydı `success` alanı hiç olmaz,
    // `statusCode`/`message` olurdu ve ham Zod dizisi sızardı.
    expect(body).not.toHaveProperty('statusCode');

    await app.close();
    vi.doUnmock('../../src/plugins/prisma.js');
    vi.doUnmock('../../src/plugins/redis.js');
    vi.doUnmock('../../src/jobs/queue.js');
  });
});
