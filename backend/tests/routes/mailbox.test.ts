import { describe, it, expect, vi } from 'vitest';
import { StaffRole } from '@prisma/client';
import { buildTestApp, authHeader } from '../helpers/app.js';
import { mailboxRoutes } from '../../src/modules/companies/mailbox.routes.js';
import { decrypt, encrypt } from '../../src/utils/crypto.js';

/**
 * Gelen posta kutusu yönetimi: yalnızca admin, sırlar asla dönmez, IMAP SSRF,
 * Gmail yetkisinin geçersiz kılınması ve OAuth state denetimi.
 */

type Row = Record<string, unknown>;

function makeApp(existing: Row | null = null) {
  let stored: Row | null = existing;
  const upsert = vi.fn(async ({ create, update }: { create: Row; update: Row }) => {
    stored = stored ? { ...stored, ...update } : { id: 'mb-1', lastFetchAt: null, ...create };
    return stored;
  });
  const update = vi.fn(async ({ data }: { data: Row }) => { stored = { ...stored, ...data }; return stored; });
  const redisStore = new Map<string, string>();
  const prisma = {
    company: { findUnique: vi.fn(async () => ({ id: 'co-1' })) },
    category: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === 'cat-1' ? { id: 'cat-1' } : null)) },
    location: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === 'loc-1' ? { id: 'loc-1' } : null)) },
    companyMailbox: {
      findUnique: vi.fn(async () => stored),
      upsert,
      update,
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    inboundMessage: { findMany: vi.fn(async () => []) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  const app = buildTestApp(prisma, {
    set: vi.fn(async (k: string, v: string) => { redisStore.set(k, v); return 'OK'; }),
    get: vi.fn(async (k: string) => (k.startsWith('staff:') ? null : redisStore.get(k) ?? null)),
    del: vi.fn(async (k: string) => { redisStore.delete(k); return 1; }),
  });
  app.setErrorHandler((err: { statusCode?: number; message: string }, _req, reply) => {
    reply.status(err.statusCode ?? 500).send({ success: false, error: err.message });
  });
  app.register(mailboxRoutes, { prefix: '/companies' });
  return { app, upsert, update, stored: () => stored, redisStore };
}

const m365 = {
  provider: 'microsoft365', address: 'Destek@Acme.com', tenantId: 't', clientId: 'c', secret: 'super-secret',
};

describe('PUT /companies/:id/mailbox', () => {
  it('yalnızca admin', async () => {
    const { app, upsert } = makeApp();
    const res = await app.inject({ method: 'PUT', url: '/companies/co-1/mailbox', headers: authHeader(StaffRole.it_manager), payload: m365 });
    expect(res.statusCode).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('sırrı şifreli saklar, yanıtta asla döndürmez, adresi küçültür', async () => {
    const { app, stored } = makeApp();
    const res = await app.inject({ method: 'PUT', url: '/companies/co-1/mailbox', headers: authHeader(StaffRole.admin), payload: m365 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain('super-secret');
    expect(res.json().data.mailbox).toMatchObject({ address: 'destek@acme.com', hasSecret: true, gmailConnected: false });
    expect(res.json().data.mailbox).not.toHaveProperty('secretEnc');
    expect(decrypt(stored()!.secretEnc as string)).toBe('super-secret');
  });

  it('ilk kayıtta sır zorunlu', async () => {
    const { app } = makeApp();
    const { secret: _secret, ...noSecret } = m365;
    const res = await app.inject({ method: 'PUT', url: '/companies/co-1/mailbox', headers: authHeader(StaffRole.admin), payload: noSecret });
    expect(res.statusCode).toBe(400);
  });

  it('sağlayıcıya göre zorunlu alanları doğrular', async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: 'PUT', url: '/companies/co-1/mailbox', headers: authHeader(StaffRole.admin), payload: { provider: 'imap', address: 'd@acme.com', secret: 'x' } });
    expect(res.statusCode).toBe(400);
  });

  it('IMAP sunucusu dahili adrese yönlendirilemez (SSRF)', async () => {
    const { app, upsert } = makeApp();
    const res = await app.inject({
      method: 'PUT', url: '/companies/co-1/mailbox', headers: authHeader(StaffRole.admin),
      payload: { provider: 'imap', address: 'd@acme.com', imapHost: '127.0.0.1', imapPort: 993, username: 'd', secret: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('ticket açma açıkken varsayılan kategori/lokasyon şirkete ait olmalı', async () => {
    const { app } = makeApp();
    const res = await app.inject({
      method: 'PUT', url: '/companies/co-1/mailbox', headers: authHeader(StaffRole.admin),
      payload: { ...m365, createTickets: true, defaultCategoryId: 'cat-1', defaultLocationId: 'loc-other' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('Gmail client ID değişince eski Google yetkisi silinir', async () => {
    const { app, stored } = makeApp({
      id: 'mb-1', companyId: 'co-1', provider: 'gmail', address: 'd@acme.com', clientId: 'old', secretEnc: encrypt('s'), refreshTokenEnc: encrypt('RT'),
    });
    await app.inject({
      method: 'PUT', url: '/companies/co-1/mailbox', headers: authHeader(StaffRole.admin),
      payload: { provider: 'gmail', address: 'd@acme.com', clientId: 'new' },
    });
    expect(stored()!.refreshTokenEnc).toBeNull();
  });

  it('Gmail ayarı değişmeden kaydedilirse yetki korunur', async () => {
    const token = encrypt('RT');
    const { app, stored } = makeApp({
      id: 'mb-1', companyId: 'co-1', provider: 'gmail', address: 'd@acme.com', clientId: 'same', secretEnc: encrypt('s'), refreshTokenEnc: token,
    });
    await app.inject({
      method: 'PUT', url: '/companies/co-1/mailbox', headers: authHeader(StaffRole.admin),
      payload: { provider: 'gmail', address: 'd@acme.com', clientId: 'same', createTickets: false },
    });
    expect(stored()!.refreshTokenEnc).toBe(token);
  });
});

describe('Gmail OAuth', () => {
  const gmail = { id: 'mb-1', companyId: 'co-1', provider: 'gmail', address: 'd@acme.com', clientId: 'cid', secretEnc: encrypt('s'), refreshTokenEnc: null };

  it('authorize → state Redis\'e posta kutusuyla yazılır', async () => {
    const { app, redisStore } = makeApp(gmail);
    const res = await app.inject({ method: 'POST', url: '/companies/co-1/mailbox/google/authorize', headers: authHeader(StaffRole.admin) });
    expect(res.statusCode, res.body).toBe(200);
    const state = new URL(res.json().data.url).searchParams.get('state')!;
    expect(redisStore.get(`mailbox:oauth:${state}`)).toBe('mb-1');
  });

  it('bilinmeyen state ile callback hata sayfasına döner ve yazma yapmaz', async () => {
    const { app, update } = makeApp(gmail);
    const res = await app.inject({ method: 'GET', url: '/companies/mailbox/oauth/google/callback?code=abc&state=forged' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('/staff/companies?mailbox=error');
    expect(update).not.toHaveBeenCalled();
  });
});
