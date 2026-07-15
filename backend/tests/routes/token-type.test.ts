import { describe, it, expect, vi } from 'vitest';
import { StaffRole } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { buildTestApp, tokenFor, refreshTokenFor } from '../helpers/app.js';
import { config } from '../../src/config/index.js';

/**
 * Token türü ve tazelik.
 *
 * İki ayrı regresyon:
 *
 * 1. **type claim'i.** Access ve refresh payload'ları BİREBİR aynıydı; ayrım
 *    yalnızca farklı secret kullanılmasına dayanıyordu ve bu zorlanmıyordu.
 *    Operatör ikisini aynı verirse (tek kopyala-yapıştır) 7 günlük refresh
 *    cookie'si geçerli bir access token'a dönüşürdü. Tür artık açıkça kontrol
 *    edilir — secret ayrımı ikinci katman.
 *
 * 2. **Geçersizleştirme.** `authenticate` JWT'yi DB'ye bakmadan kabul ediyordu:
 *    rolü düşürülen biri access token'ı dolana kadar (15 dk) eski rolüyle
 *    çalışıyordu.
 */

vi.mock('../../src/db.js', () => ({ prisma: { auditLog: { create: vi.fn() } } }));

/**
 * Probe route'u bir PLUGIN içinde kaydedilir.
 *
 * `app.authenticate` decorator'ı authPlugin yüklendiğinde oluşur; doğrudan
 * `app.get(..., { preHandler: [app.authenticate] })` yazılırsa decorator henüz
 * tanımsızdır ve Fastify "preHandler hook should be a function" der. Plugin
 * içinde kayıt, sıranın çözülmesini bekler.
 */
function appWithProbe(redisStub: Record<string, unknown> = {}) {
  const app = buildTestApp({}, redisStub);
  void app.register(async (instance) => {
    instance.get('/probe', { preHandler: [instance.authenticate] }, async (req) => ({
      ok: true,
      role: req.staffUser!.role,
    }));
  });
  return app;
}

describe('access token türü', () => {
  it('geçerli access token kabul edilir', async () => {
    const app = appWithProbe();
    await app.ready();
    const res = await app.inject({
      method: 'GET', url: '/probe',
      headers: { authorization: `Bearer ${tokenFor(StaffRole.admin)}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('REFRESH token access olarak KULLANILAMAZ (secret ayrımından bağımsız)', async () => {
    const app = appWithProbe();
    await app.ready();
    const res = await app.inject({
      method: 'GET', url: '/probe',
      headers: { authorization: `Bearer ${refreshTokenFor(StaffRole.admin)}` },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('secret AYNI olsa bile refresh token access olarak geçmez', async () => {
    // Asıl senaryo: operatör JWT_SECRET ve JWT_REFRESH_SECRET'i eşit verirse.
    // type claim'i olmasaydı bu token geçerdi.
    const app = appWithProbe();
    await app.ready();
    const forged = jwt.sign(
      { id: 's1', email: 'a@b.c', role: StaffRole.admin, type: 'refresh', sid: 'x' },
      config.JWT_SECRET, // access secret'ı ile imzalandı!
      { expiresIn: '7d' },
    );
    const res = await app.inject({
      method: 'GET', url: '/probe',
      headers: { authorization: `Bearer ${forged}` },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('type claim\'i olmayan (eski) token reddedilir', async () => {
    const app = appWithProbe();
    await app.ready();
    const legacy = jwt.sign(
      { id: 's1', email: 'a@b.c', role: StaffRole.admin },
      config.JWT_SECRET,
      { expiresIn: '15m' },
    );
    const res = await app.inject({
      method: 'GET', url: '/probe',
      headers: { authorization: `Bearer ${legacy}` },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('cookie ile kimlik KABUL EDİLMEZ — yalnızca Authorization header', async () => {
    // Ambient credential kapısı kapalı: access_token cookie'si bir yolla
    // tarayıcıya düşse bile CSRF yüzeyi açılmaz.
    const app = appWithProbe();
    await app.ready();
    const res = await app.inject({
      method: 'GET', url: '/probe',
      cookies: { access_token: tokenFor(StaffRole.admin) },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('access token geçersizleştirme (rol değişimi)', () => {
  it('geçersizleştirme anından ÖNCE üretilmiş token reddedilir', async () => {
    // Token şimdi üretildi; geçersizleştirme anı 1 saat SONRASI gibi görünüyor.
    const future = String(Math.floor(Date.now() / 1000) + 3600);
    const app = appWithProbe({ get: async () => future });
    await app.ready();
    const res = await app.inject({
      method: 'GET', url: '/probe',
      headers: { authorization: `Bearer ${tokenFor(StaffRole.admin)}` },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('geçersizleştirmeden SONRA üretilmiş token kabul edilir', async () => {
    const past = String(Math.floor(Date.now() / 1000) - 3600);
    const app = appWithProbe({ get: async () => past });
    await app.ready();
    const res = await app.inject({
      method: 'GET', url: '/probe',
      headers: { authorization: `Bearer ${tokenFor(StaffRole.admin)}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('geçersizleştirme kaydı yoksa token kabul edilir', async () => {
    const app = appWithProbe({ get: async () => null });
    await app.ready();
    const res = await app.inject({
      method: 'GET', url: '/probe',
      headers: { authorization: `Bearer ${tokenFor(StaffRole.admin)}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
