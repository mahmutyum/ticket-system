import { describe, it, expect, vi } from 'vitest';
import { StaffRole } from '@prisma/client';
import { buildTestApp, authHeader } from '../helpers/app.js';

const ldapAuthenticate = vi.fn();
const createAuditLog = vi.fn(async () => undefined);
vi.mock('../../src/middleware/audit.js', () => ({ createAuditLog }));
vi.mock('../../src/services/sso/protocols.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/services/sso/protocols.js')>();
  return { ...original, ldapAuthenticate };
});
vi.mock('../../src/utils/net-guard.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/utils/net-guard.js')>();
  return { ...original, assertIntegrationHost: async () => undefined };
});
const { ssoRoutes } = await import('../../src/modules/auth/sso.routes.js');
const { LdapAuthError } = await import('../../src/services/sso/protocols.js');
const { encrypt } = await import('../../src/utils/crypto.js');

type Row = Record<string, unknown>;

function makeApp(opts: { providers?: Row[]; activeCount?: number; companies?: number } = {}) {
  const create = vi.fn(async ({ data }: { data: Row }) => ({ id: 'p1', createdAt: new Date(), updatedAt: new Date(), ...data }));
  const prisma = {
    identityProvider: {
      findMany: vi.fn(async () => opts.providers ?? []),
      findUnique: vi.fn(async ({ where }: { where: { slug?: string } }) => (opts.providers ?? []).find(p => p.slug === where.slug) ?? null),
      count: vi.fn(async () => opts.activeCount ?? 0),
      create,
    },
    company: { count: vi.fn(async () => opts.companies ?? 0) },
    systemSetting: { findUnique: async () => null, upsert: vi.fn(async () => ({})) },
  };
  const app = buildTestApp(prisma);
  app.setErrorHandler((err: { statusCode?: number; message: string }, _req, reply) => {
    reply.status(err.statusCode ?? 500).send({ success: false, error: err.message });
  });
  app.register(ssoRoutes, { prefix: '/auth/sso' });
  return { app, create, prisma };
}

const oidcBody = {
  slug: 'entra', name: 'Microsoft', type: 'oidc',
  config: { issuer: 'https://login.microsoftonline.com/tenant/v2.0', clientId: 'cid' },
};

describe('SSO yönetimi', () => {
  it('yalnızca admin', async () => {
    const { app, create } = makeApp();
    const list = await app.inject({ method: 'GET', url: '/auth/sso/admin/providers', headers: authHeader(StaffRole.it_manager) });
    expect(list.statusCode).toBe(403);
    const add = await app.inject({ method: 'POST', url: '/auth/sso/admin/providers', headers: authHeader(StaffRole.it_manager), payload: { ...oidcBody, secret: 'x' } });
    expect(add.statusCode).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it('OIDC client secret zorunlu; sır şifreli saklanır ve dönmez', async () => {
    const { app, create } = makeApp();
    expect((await app.inject({ method: 'POST', url: '/auth/sso/admin/providers', headers: authHeader(StaffRole.admin), payload: oidcBody })).statusCode).toBe(400);
    const res = await app.inject({ method: 'POST', url: '/auth/sso/admin/providers', headers: authHeader(StaffRole.admin), payload: { ...oidcBody, secret: 'top-secret' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain('top-secret');
    expect(res.json().data).toMatchObject({ hasSecret: true, urls: { redirectUri: 'http://localhost:1111/api/auth/sso/entra/callback' } });
    const stored = create.mock.calls[0][0].data;
    expect(stored.secretEnc).not.toBe('top-secret');
  });

  it('SAML için sır gerekmez; ayarlar tür şemasıyla doğrulanır', async () => {
    const { app } = makeApp();
    const bad = await app.inject({ method: 'POST', url: '/auth/sso/admin/providers', headers: authHeader(StaffRole.admin), payload: { slug: 'adfs', name: 'ADFS', type: 'saml', config: { entryPoint: 'not-a-url' } } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'POST', url: '/auth/sso/admin/providers', headers: authHeader(StaffRole.admin),
      payload: { slug: 'adfs', name: 'ADFS', type: 'saml', config: { entryPoint: 'https://adfs.firma.com/adfs/ls', idpCert: 'MIIC'.padEnd(40, 'A') } },
    });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('şirket eşlemesi var olmayan şirkete işaret edemez', async () => {
    const { app } = makeApp({ companies: 0 });
    const res = await app.inject({
      method: 'POST', url: '/auth/sso/admin/providers', headers: authHeader(StaffRole.admin),
      payload: { ...oidcBody, secret: 'x', companyMappings: [{ group: 'IT', companyId: 'ghost' }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('aktif sağlayıcı yokken yerel giriş kapatılamaz (herkes kilitlenirdi)', async () => {
    const { app, prisma } = makeApp({ activeCount: 0 });
    const res = await app.inject({ method: 'PUT', url: '/auth/sso/admin/settings', headers: authHeader(StaffRole.admin), payload: { localLoginDisabled: true } });
    expect(res.statusCode).toBe(400);
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
  });
});

describe('LDAP girişi', () => {
  const ldapProvider = {
    id: 'l1', slug: 'ad', name: 'AD', type: 'ldap', isActive: true, secretEnc: encrypt('bindpw'),
    config: { url: 'ldaps://dc.firma.local', bindDn: 'cn=svc', baseDn: 'dc=firma,dc=local' },
    jitProvisioning: false, roleMappings: [], companyMappings: [], createdAt: new Date(), updatedAt: new Date(),
  };

  it('kullanıcı yok ve parola yanlış aynı genel hatayı döner; denetime yazılır', async () => {
    const { app } = makeApp({ providers: [ldapProvider] });
    for (const reason of ['user_not_found', 'invalid_credentials']) {
      ldapAuthenticate.mockRejectedValueOnce(new LdapAuthError(reason));
      const res = await app.inject({ method: 'POST', url: '/auth/sso/ad/login', payload: { username: 'ayse', password: 'x' } });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('Geçersiz email veya şifre');
    }
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'sso_login_failed', changes: expect.objectContaining({ reason: 'invalid_credentials' }) }));
    expect(ldapAuthenticate).toHaveBeenCalledWith(expect.objectContaining({ url: 'ldaps://dc.firma.local' }), 'bindpw', 'ayse', 'x');
  });

  it('pasif sağlayıcı 404', async () => {
    const { app } = makeApp({ providers: [{ ...ldapProvider, isActive: false }] });
    const res = await app.inject({ method: 'POST', url: '/auth/sso/ad/login', payload: { username: 'ayse', password: 'x' } });
    expect(res.statusCode).toBe(404);
  });
});
