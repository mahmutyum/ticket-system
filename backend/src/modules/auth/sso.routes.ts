import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { IdentityProviderType, Prisma, type IdentityProvider } from '@prisma/client';
import { config } from '../../config/index.js';
import { createAuditLog } from '../../middleware/audit.js';
import { invalidateAccessTokens } from '../../plugins/auth.js';
import {
  companyMappingSchema,
  configSchemaFor,
  parseProviderConfig,
  roleMappingSchema,
  authSettingsSchema,
} from '../../services/sso/config.js';
import {
  ldapAuthenticate,
  LdapAuthError,
  oidcAuthorizationUrl,
  oidcCallback,
  oidcConfiguration,
  redisSamlCache,
  samlClient,
  samlIdentity,
  type OidcChecks,
} from '../../services/sso/protocols.js';
import { resolveSsoStaff, type SsoIdentity } from '../../services/sso/resolve.js';
import { getAuthSettings } from '../../services/system-settings.js';
import { commonErrorResponses, errorResponseSchema, successResponseSchema } from '../../utils/api-schema.js';
import { decrypt, encrypt } from '../../utils/crypto.js';
import { assertIntegrationHost, BlockedHostError } from '../../utils/net-guard.js';
import { t } from '../../i18n/index.js';
import { loginResponseSchema } from './auth.schema.js';
import { issueSession } from './session.js';

/**
 * Personel SSO — OIDC, SAML 2.0 ve LDAP/AD.
 *
 * Tarayıcı akışları (OIDC/SAML) başarıda refresh cookie'sini set eder ve giriş
 * sayfasına `?sso=ok` ile döner; frontend oturumu `/auth/staff/refresh` ile alır
 * (access token URL'e hiç yazılmaz). Hata kodları `?sso_error=<kod>` ile taşınır —
 * ayrıntı yalnızca denetim kaydındadır.
 */

const slugParams = z.object({ slug: z.string().regex(/^[a-z0-9-]{2,40}$/) });
const idParams = z.object({ id: z.string().min(1).max(128) });
const STATE_TTL = 10 * 60;

const baseUrl = () => `${config.CANONICAL_URL}/api/auth/sso`;
export const ssoUrls = (slug: string) => ({
  redirectUri: `${baseUrl()}/${slug}/callback`,
  acsUrl: `${baseUrl()}/${slug}/acs`,
  metadataUrl: `${baseUrl()}/${slug}/metadata`,
});

const providerBodySchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/, 'a-z, 0-9, -'),
  name: z.string().trim().min(1).max(100),
  type: z.nativeEnum(IdentityProviderType),
  isActive: z.boolean().default(true),
  config: z.record(z.unknown()),
  /** Boş bırakılırsa kayıtlı sır korunur. */
  secret: z.string().max(4000).optional(),
  jitProvisioning: z.boolean().default(false),
  roleMappings: roleMappingSchema.default([]),
  companyMappings: companyMappingSchema.default([]),
});

const providerViewSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  type: z.nativeEnum(IdentityProviderType),
  isActive: z.boolean(),
  config: z.unknown(),
  hasSecret: z.boolean(),
  jitProvisioning: z.boolean(),
  roleMappings: z.unknown(),
  companyMappings: z.unknown(),
  urls: z.object({ redirectUri: z.string(), acsUrl: z.string(), metadataUrl: z.string() }),
});

const toView = (p: IdentityProvider) => ({
  id: p.id, slug: p.slug, name: p.name, type: p.type, isActive: p.isActive, config: p.config,
  hasSecret: !!p.secretEnc, jitProvisioning: p.jitProvisioning,
  roleMappings: p.roleMappings, companyMappings: p.companyMappings, urls: ssoUrls(p.slug),
});

export const ssoRoutes: FastifyPluginAsyncZod = async (app) => {
  // SAML ACS, IdP'den form POST (application/x-www-form-urlencoded) alır. Parser
  // yalnızca bu eklenti kapsamında tanımlıdır; diğer uçlar JSON dışını kabul etmez.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 512 * 1024 }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  const ip = (request: FastifyRequest) => (request.headers['x-real-ip'] as string) || request.ip;

  async function activeProvider(slug: string, type?: IdentityProviderType) {
    const provider = await app.prisma.identityProvider.findUnique({ where: { slug } });
    if (!provider?.isActive || (type && provider.type !== type)) return null;
    return provider;
  }

  const loginPage = (query: string) => `${config.CANONICAL_URL}/staff/login?${query}`;

  /** Kimliği hesaba çözer, oturumu açar ve denetim kaydı yazar. */
  async function completeLogin(request: FastifyRequest, reply: FastifyReply, provider: IdentityProvider, identity: SsoIdentity, allowedDomains: string[]) {
    const result = await resolveSsoStaff(app.prisma, provider, identity, allowedDomains);
    if ('error' in result) {
      await createAuditLog({
        entityType: 'auth', entityId: identity.email || identity.subject, action: 'sso_login_failed',
        changes: { provider: provider.slug, reason: result.error, groups: identity.groups.slice(0, 20) },
        performedBy: identity.email || identity.subject, ipAddress: ip(request),
      });
      return { error: result.error };
    }
    if (result.roleChanged) await invalidateAccessTokens(app.redis, result.staff.id);
    await createAuditLog({
      entityType: 'auth', entityId: result.staff.id, action: 'sso_login',
      changes: { provider: provider.slug, role: result.staff.role, roleChanged: result.roleChanged },
      performedBy: result.staff.email, ipAddress: ip(request),
    });
    return { data: await issueSession(app, reply, result.staff) };
  }

  // ==================== PUBLIC ====================

  app.get('/providers', {
    schema: {
      tags: ['Auth'],
      summary: 'Giriş ekranı için aktif SSO sağlayıcıları',
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            providers: z.array(z.object({ slug: z.string(), name: z.string(), type: z.nativeEnum(IdentityProviderType) })),
            localLoginDisabled: z.boolean(),
          }),
        }),
      },
    },
  }, async (_request, reply) => {
    const providers = await app.prisma.identityProvider.findMany({
      where: { isActive: true },
      select: { slug: true, name: true, type: true },
      orderBy: { name: 'asc' },
    });
    const settings = await getAuthSettings(app.prisma);
    reply.send({ success: true, data: { providers, localLoginDisabled: settings.localLoginDisabled } });
  });

  app.get('/:slug/start', {
    schema: { tags: ['Auth'], summary: 'OIDC/SAML girişini başlatır', params: slugParams },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const provider = await activeProvider(request.params.slug);
    if (!provider || provider.type === IdentityProviderType.ldap) return reply.redirect(loginPage('sso_error=unknown_provider'));
    const urls = ssoUrls(provider.slug);
    try {
      if (provider.type === IdentityProviderType.oidc) {
        const cfg = parseProviderConfig(IdentityProviderType.oidc, provider.config);
        await assertIntegrationHost(new URL(cfg.issuer).hostname, config.ALLOW_PRIVATE_INTEGRATION_HOSTS);
        const oidcConfig = await oidcConfiguration(`${provider.id}:${provider.updatedAt.getTime()}`, cfg, decrypt(provider.secretEnc ?? ''));
        const { url, checks } = await oidcAuthorizationUrl(oidcConfig, cfg, urls.redirectUri);
        await app.redis.set(`sso:oidc:${checks.state}`, JSON.stringify({ providerId: provider.id, checks }), 'EX', STATE_TTL);
        return reply.redirect(url);
      }
      const cfg = parseProviderConfig(IdentityProviderType.saml, provider.config);
      const saml = samlClient(cfg, urls.metadataUrl, urls.acsUrl, redisSamlCache(app.redis, `sso:saml:${provider.id}:`));
      return reply.redirect(await saml.getAuthorizeUrlAsync(nanoid(16), undefined, {}));
    } catch (err) {
      request.log.warn({ err, provider: provider.slug }, 'SSO start failed');
      return reply.redirect(loginPage('sso_error=provider_unavailable'));
    }
  });

  // OIDC geri dönüşü — tek kullanımlık `state` Redis'te sağlayıcıya ve PKCE/nonce'a bağlıdır.
  app.get('/:slug/callback', {
    schema: { tags: ['Auth'], summary: 'OIDC geri dönüşü', params: slugParams },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const key = `sso:oidc:${query.state ?? ''}`;
    const stored = query.state ? await app.redis.get(key) : null;
    await app.redis.del(key);
    const provider = await activeProvider(request.params.slug, IdentityProviderType.oidc);
    if (!stored || !provider) return reply.redirect(loginPage('sso_error=invalid_state'));
    const { providerId, checks } = JSON.parse(stored) as { providerId: string; checks: OidcChecks };
    if (providerId !== provider.id) return reply.redirect(loginPage('sso_error=invalid_state'));

    try {
      const cfg = parseProviderConfig(IdentityProviderType.oidc, provider.config);
      const oidcConfig = await oidcConfiguration(`${provider.id}:${provider.updatedAt.getTime()}`, cfg, decrypt(provider.secretEnc ?? ''));
      const currentUrl = new URL(ssoUrls(provider.slug).redirectUri);
      currentUrl.search = new URL(request.url, 'http://x').search;
      const identity = await oidcCallback(oidcConfig, cfg, currentUrl, checks);
      const result = await completeLogin(request, reply, provider, identity, cfg.allowedDomains);
      return reply.redirect(loginPage('error' in result ? `sso_error=${result.error}` : 'sso=ok'));
    } catch (err) {
      request.log.warn({ err, provider: provider.slug }, 'OIDC callback failed');
      return reply.redirect(loginPage('sso_error=provider_rejected'));
    }
  });

  // SAML Assertion Consumer Service (HTTP-POST binding).
  app.post('/:slug/acs', {
    schema: { tags: ['Auth'], summary: 'SAML yanıtı (ACS)', params: slugParams },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const provider = await activeProvider(request.params.slug, IdentityProviderType.saml);
    if (!provider) return reply.redirect(loginPage('sso_error=unknown_provider'));
    try {
      const cfg = parseProviderConfig(IdentityProviderType.saml, provider.config);
      const urls = ssoUrls(provider.slug);
      const saml = samlClient(cfg, urls.metadataUrl, urls.acsUrl, redisSamlCache(app.redis, `sso:saml:${provider.id}:`));
      const { profile } = await saml.validatePostResponseAsync(request.body as Record<string, string>);
      if (!profile) return reply.redirect(loginPage('sso_error=provider_rejected'));
      const result = await completeLogin(request, reply, provider, samlIdentity(profile, cfg), cfg.allowedDomains);
      return reply.redirect(loginPage('error' in result ? `sso_error=${result.error}` : 'sso=ok'), 303);
    } catch (err) {
      request.log.warn({ err, provider: provider.slug }, 'SAML response rejected');
      return reply.redirect(loginPage('sso_error=provider_rejected'), 303);
    }
  });

  app.get('/:slug/metadata', {
    schema: { tags: ['Auth'], summary: 'SAML SP metadata', params: slugParams },
  }, async (request, reply) => {
    const provider = await activeProvider(request.params.slug, IdentityProviderType.saml);
    if (!provider) return reply.status(404).send({ success: false, error: t(request, 'auth.sso_provider_not_found') });
    const cfg = parseProviderConfig(IdentityProviderType.saml, provider.config);
    const urls = ssoUrls(provider.slug);
    const saml = samlClient(cfg, urls.metadataUrl, urls.acsUrl, redisSamlCache(app.redis, `sso:saml:${provider.id}:`));
    reply.type('application/samlmetadata+xml').send(saml.generateServiceProviderMetadata(null));
  });

  // LDAP / AD — kullanıcı adı + parola (JSON), yerel girişle aynı yanıt biçimi.
  app.post('/:slug/login', {
    schema: {
      tags: ['Auth'],
      summary: 'LDAP/AD ile giriş',
      params: slugParams,
      body: z.object({ username: z.string().trim().min(1).max(200), password: z.string().min(1).max(500) }),
      response: { 200: loginResponseSchema, ...commonErrorResponses },
    },
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const provider = await activeProvider(request.params.slug, IdentityProviderType.ldap);
    if (!provider) return reply.status(404).send({ success: false, error: t(request, 'auth.sso_provider_not_found') });
    const cfg = parseProviderConfig(IdentityProviderType.ldap, provider.config);
    let identity: SsoIdentity;
    try {
      await assertIntegrationHost(new URL(cfg.url).hostname, config.ALLOW_PRIVATE_INTEGRATION_HOSTS);
      identity = await ldapAuthenticate(cfg, decrypt(provider.secretEnc ?? ''), request.body.username, request.body.password);
    } catch (err) {
      const reason = err instanceof LdapAuthError ? err.message : 'directory_unavailable';
      await createAuditLog({
        entityType: 'auth', entityId: request.body.username, action: 'sso_login_failed',
        changes: { provider: provider.slug, reason }, performedBy: request.body.username, ipAddress: ip(request),
      });
      if (!(err instanceof LdapAuthError)) request.log.warn({ err, provider: provider.slug }, 'LDAP unavailable');
      // Kullanıcı yok / parola yanlış ayrımı yapılmaz (sayım oracle'ı olmasın).
      return reply.status(401).send({ success: false, error: t(request, 'auth.invalid_credentials') });
    }
    const result = await completeLogin(request, reply, provider, identity, cfg.allowedDomains);
    if ('error' in result) {
      return reply.status(403).send({ success: false, error: t(request, `auth.sso_${result.error}`) });
    }
    reply.send({ success: true, data: result.data });
  });

  // ==================== ADMIN ====================
  const adminOnly = [app.requireRole('admin')];

  app.get('/admin/providers', {
    preValidation: adminOnly,
    schema: {
      tags: ['Auth'],
      summary: 'Kimlik sağlayıcılarını listeler',
      response: { 200: z.object({ success: z.literal(true), data: z.array(providerViewSchema) }), ...commonErrorResponses },
    },
  }, async (_request, reply) => {
    const providers = await app.prisma.identityProvider.findMany({ orderBy: { createdAt: 'asc' } });
    reply.send({ success: true, data: providers.map(toView) });
  });

  async function validateProvider(request: FastifyRequest, reply: FastifyReply, body: z.infer<typeof providerBodySchema>, hasStoredSecret: boolean) {
    const parsed = configSchemaFor(body.type).safeParse(body.config);
    if (!parsed.success) {
      reply.status(400).send({ success: false, error: `${t(request, 'auth.sso_invalid_config')}: ${parsed.error.issues.map(i => i.path.join('.')).join(', ')}` });
      return null;
    }
    if (body.type !== IdentityProviderType.saml && !body.secret && !hasStoredSecret) {
      reply.status(400).send({ success: false, error: t(request, 'auth.sso_secret_required') });
      return null;
    }
    // Sunucunun bağlanacağı hedefler SSRF denetiminden geçer (SAML'da sunucu IdP'ye bağlanmaz).
    const host =
      body.type === IdentityProviderType.oidc ? new URL((parsed.data as { issuer: string }).issuer).hostname
        : body.type === IdentityProviderType.ldap ? new URL((parsed.data as { url: string }).url).hostname
          : null;
    if (host) {
      try {
        await assertIntegrationHost(host, config.ALLOW_PRIVATE_INTEGRATION_HOSTS);
      } catch (err) {
        if (err instanceof BlockedHostError) {
          reply.status(400).send({ success: false, error: t(request, 'auth.sso_host_blocked') });
          return null;
        }
        throw err;
      }
    }
    const companyIds = body.companyMappings.map(m => m.companyId);
    if (companyIds.length) {
      const found = await app.prisma.company.count({ where: { id: { in: companyIds } } });
      if (found !== new Set(companyIds).size) {
        reply.status(400).send({ success: false, error: t(request, 'auth.sso_invalid_company') });
        return null;
      }
    }
    return parsed.data as Prisma.InputJsonValue;
  }

  const providerResponse = { 200: z.object({ success: z.literal(true), data: providerViewSchema }), ...commonErrorResponses, 409: errorResponseSchema };

  app.post('/admin/providers', {
    preValidation: adminOnly,
    schema: { tags: ['Auth'], summary: 'Kimlik sağlayıcı ekler', body: providerBodySchema, response: providerResponse },
  }, async (request, reply) => {
    const body = request.body;
    const cfg = await validateProvider(request, reply, body, false);
    if (!cfg) return;
    try {
      const provider = await app.prisma.identityProvider.create({
        data: {
          slug: body.slug, name: body.name, type: body.type, isActive: body.isActive, config: cfg,
          secretEnc: body.secret ? encrypt(body.secret) : null, jitProvisioning: body.jitProvisioning,
          roleMappings: body.roleMappings, companyMappings: body.companyMappings,
        },
      });
      await createAuditLog({
        entityType: 'identity_provider', entityId: provider.id, action: 'create',
        changes: { slug: body.slug, type: body.type, jit: body.jitProvisioning },
        performedBy: request.staffUser!.email, ipAddress: ip(request),
      });
      reply.send({ success: true, data: toView(provider) });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.status(409).send({ success: false, error: t(request, 'auth.sso_slug_exists') });
      }
      throw err;
    }
  });

  app.put('/admin/providers/:id', {
    preValidation: adminOnly,
    schema: { tags: ['Auth'], summary: 'Kimlik sağlayıcıyı günceller', params: idParams, body: providerBodySchema, response: providerResponse },
  }, async (request, reply) => {
    const existing = await app.prisma.identityProvider.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.status(404).send({ success: false, error: t(request, 'auth.sso_provider_not_found') });
    const body = request.body;
    const cfg = await validateProvider(request, reply, body, !!existing.secretEnc && existing.type === body.type);
    if (!cfg) return;
    try {
      const provider = await app.prisma.identityProvider.update({
        where: { id: existing.id },
        data: {
          slug: body.slug, name: body.name, type: body.type, isActive: body.isActive, config: cfg,
          ...(body.secret ? { secretEnc: encrypt(body.secret) } : existing.type !== body.type ? { secretEnc: null } : {}),
          jitProvisioning: body.jitProvisioning, roleMappings: body.roleMappings, companyMappings: body.companyMappings,
        },
      });
      await createAuditLog({
        entityType: 'identity_provider', entityId: provider.id, action: 'update',
        changes: { slug: body.slug, type: body.type, isActive: body.isActive, jit: body.jitProvisioning, secretChanged: !!body.secret },
        performedBy: request.staffUser!.email, ipAddress: ip(request),
      });
      reply.send({ success: true, data: toView(provider) });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.status(409).send({ success: false, error: t(request, 'auth.sso_slug_exists') });
      }
      throw err;
    }
  });

  app.delete('/admin/providers/:id', {
    preValidation: adminOnly,
    schema: { tags: ['Auth'], summary: 'Kimlik sağlayıcıyı siler', params: idParams, response: { 200: successResponseSchema, ...commonErrorResponses } },
  }, async (request, reply) => {
    const result = await app.prisma.identityProvider.deleteMany({ where: { id: request.params.id } });
    if (result.count === 0) return reply.status(404).send({ success: false, error: t(request, 'auth.sso_provider_not_found') });
    await createAuditLog({
      entityType: 'identity_provider', entityId: request.params.id, action: 'delete', changes: {},
      performedBy: request.staffUser!.email, ipAddress: ip(request),
    });
    reply.send({ success: true });
  });

  app.get('/admin/settings', {
    preValidation: adminOnly,
    schema: { tags: ['Auth'], summary: 'Giriş ayarları', response: { 200: z.object({ success: z.literal(true), data: authSettingsSchema }), ...commonErrorResponses } },
  }, async (_request, reply) => {
    reply.send({ success: true, data: await getAuthSettings(app.prisma) });
  });

  app.put('/admin/settings', {
    preValidation: adminOnly,
    schema: {
      tags: ['Auth'],
      summary: 'Giriş ayarlarını günceller',
      body: authSettingsSchema,
      response: { 200: z.object({ success: z.literal(true), data: authSettingsSchema }), ...commonErrorResponses },
    },
  }, async (request, reply) => {
    // Yerel giriş kapatılırken en az bir aktif sağlayıcı olmalı — aksi hâlde yalnızca
    // admin'ler girebilir ve personel kilitlenir.
    if (request.body.localLoginDisabled) {
      const active = await app.prisma.identityProvider.count({ where: { isActive: true } });
      if (active === 0) return reply.status(400).send({ success: false, error: t(request, 'auth.sso_no_active_provider') });
    }
    await app.prisma.systemSetting.upsert({
      where: { key: 'auth' },
      create: { key: 'auth', value: request.body },
      update: { value: request.body },
    });
    await createAuditLog({
      entityType: 'system_setting', entityId: 'auth', action: 'update', changes: request.body,
      performedBy: request.staffUser!.email, ipAddress: ip(request),
    });
    reply.send({ success: true, data: request.body });
  });
};
