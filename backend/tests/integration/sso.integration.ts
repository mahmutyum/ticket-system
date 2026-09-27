import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { OAuth2Server } from 'oauth2-mock-server';

/**
 * OIDC girişi uçtan uca: gerçek PostgreSQL + Redis, gerçek openid-client, yerel sahte
 * OIDC sağlayıcı (discovery, PKCE, nonce, imzalı id_token). Sahte sağlayıcı 127.0.0.1'de
 * çalıştığı için yalnızca SSRF denetimi bu testte devre dışıdır.
 */
vi.mock('../../src/utils/net-guard.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/utils/net-guard.js')>();
  return { ...original, assertIntegrationHost: async () => undefined };
});

let app: FastifyInstance;
let prisma: PrismaClient;
let adminToken: string;
const idp = new OAuth2Server();
const slug = `mock-${Date.now().toString(36)}`;
const email = `sso-user-${Date.now()}@example.com`;
let groups: string[] = ['IT-Support'];

beforeAll(async () => {
  await idp.issuer.keys.generate('RS256');
  await idp.start(0, '127.0.0.1');
  idp.service.on('beforeTokenSigning', (token) => {
    Object.assign(token.payload, { sub: `sub-${email}`, email, name: 'SSO Kullanıcı', groups });
  });

  const module = await import('../../src/app.js');
  app = await module.buildApp();
  await app.ready();
  prisma = (await import('../../src/db.js')).prisma;
  adminToken = (await app.inject({ method: 'POST', url: '/auth/staff/login', payload: { email: 'admin@company.com', password: 'admin123' } })).json().data.accessToken;
});

afterAll(async () => {
  await prisma.systemSetting.deleteMany({ where: { key: 'auth' } });
  await prisma.identityProvider.deleteMany({ where: { slug } });
  await app.close();
  await idp.stop();
});

async function ssoLogin(): Promise<{ location: string; cookie?: string }> {
  const start = await app.inject({ method: 'GET', url: `/auth/sso/${slug}/start` });
  expect(start.statusCode, start.body).toBe(302);
  // Sahte IdP authorize ucu kodu + state ile redirect_uri'ye geri yönlendirir.
  const authorize = await fetch(start.headers.location as string, { redirect: 'manual' });
  const back = new URL(authorize.headers.get('location')!);
  expect(back.pathname).toBe(`/api/auth/sso/${slug}/callback`);
  const callback = await app.inject({ method: 'GET', url: `/auth/sso/${slug}/callback${back.search}` });
  const setCookie = callback.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie : [setCookie]).find(c => c?.startsWith('refresh_token='));
  return { location: callback.headers.location as string, cookie: cookie?.split(';')[0] };
}

describe('OIDC SSO — uçtan uca', () => {
  it('admin sağlayıcıyı ekler (sır dönmez)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/sso/admin/providers', headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        slug, name: 'Mock IdP', type: 'oidc', secret: 'mock-secret', jitProvisioning: true,
        config: { issuer: idp.issuer.url, clientId: 'ticket-system' },
        roleMappings: [{ group: 'IT-Support', role: 'it_staff' }],
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain('mock-secret');
    const list = await app.inject({ method: 'GET', url: '/auth/sso/providers' });
    expect(list.json().data.providers).toEqual(expect.arrayContaining([{ slug, name: 'Mock IdP', type: 'oidc' }]));
  });

  it('JIT ile hesap açılır, refresh cookie set edilir ve oturum alınır', async () => {
    const { location, cookie } = await ssoLogin();
    expect(location).toBe('http://localhost:1111/staff/login?sso=ok');
    expect(cookie).toBeDefined();

    const refresh = await app.inject({ method: 'POST', url: '/auth/staff/refresh', headers: { cookie: cookie! }, payload: {} });
    expect(refresh.statusCode, refresh.body).toBe(200);
    expect(refresh.json().data.user).toMatchObject({ email, role: 'it_staff' });

    const staff = await prisma.staff.findUniqueOrThrow({ where: { email } });
    expect(staff.externalSubject).toBe(`sub-${email}`);
  });

  it('state yeniden kullanılamaz', async () => {
    const start = await app.inject({ method: 'GET', url: `/auth/sso/${slug}/start` });
    const back = new URL((await fetch(start.headers.location as string, { redirect: 'manual' })).headers.get('location')!);
    await app.inject({ method: 'GET', url: `/auth/sso/${slug}/callback${back.search}` });
    const replay = await app.inject({ method: 'GET', url: `/auth/sso/${slug}/callback${back.search}` });
    expect(replay.headers.location).toContain('sso_error=invalid_state');
  });

  it('eşlenen gruptan çıkarılan kullanıcı giremez', async () => {
    groups = ['Sales'];
    const { location, cookie } = await ssoLogin();
    expect(location).toContain('sso_error=no_matching_group');
    expect(cookie).toBeUndefined();
    groups = ['IT-Support'];
  });

  it('yerel giriş kapatılınca personel parolayla giremez, admin girebilir', async () => {
    const auth = { authorization: `Bearer ${adminToken}` };
    const set = await app.inject({ method: 'PUT', url: '/auth/sso/admin/settings', headers: auth, payload: { localLoginDisabled: true } });
    expect(set.statusCode, set.body).toBe(200);
    const staffLogin = await app.inject({ method: 'POST', url: '/auth/staff/login', payload: { email: 'it@company.com', password: 'staff123' } });
    expect(staffLogin.statusCode).toBe(403);
    const adminLogin = await app.inject({ method: 'POST', url: '/auth/staff/login', payload: { email: 'admin@company.com', password: 'admin123' } });
    expect(adminLogin.statusCode).toBe(200);
    await app.inject({ method: 'PUT', url: '/auth/sso/admin/settings', headers: auth, payload: { localLoginDisabled: false } });
  });
});
