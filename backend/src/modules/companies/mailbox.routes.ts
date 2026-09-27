import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { MailboxProvider, Prisma } from '@prisma/client';
import { config } from '../../config/index.js';
import { createAuditLog } from '../../middleware/audit.js';
import { commonErrorResponses, errorResponseSchema, successResponseSchema } from '../../utils/api-schema.js';
import { decrypt, encrypt } from '../../utils/crypto.js';
import { assertIntegrationHost, BlockedHostError } from '../../utils/net-guard.js';
import { createMailSource } from '../../services/mail/mailbox.js';
import { exchangeGoogleCode, googleAuthorizeUrl } from '../../services/mail/sources.js';
import { t } from '../../i18n/index.js';

/**
 * Şirket gelen posta kutusu (e-postayla yanıt) — yalnızca admin (SMTP ile aynı).
 *
 * Sırlar (IMAP parolası, M365/Google client secret, Gmail refresh token) AES-256-GCM
 * ile şifreli saklanır ve API'den ASLA dönmez; yalnızca "tanımlı mı" bilgisi döner.
 */

const idParamsSchema = z.object({ id: z.string().min(1).max(128) });

const mailboxBodySchema = z
  .object({
    provider: z.nativeEnum(MailboxProvider),
    address: z.string().trim().toLowerCase().email().max(254),
    isActive: z.boolean().default(true),
    imapHost: z.string().trim().max(253).nullish(),
    imapPort: z.number().int().min(1).max(65535).nullish(),
    imapSecure: z.boolean().default(true),
    username: z.string().trim().max(254).nullish(),
    tenantId: z.string().trim().max(100).nullish(),
    clientId: z.string().trim().max(200).nullish(),
    /** Boş bırakılırsa kayıtlı sır korunur. */
    secret: z.string().max(2000).optional(),
    createTickets: z.boolean().default(false),
    defaultCategoryId: z.string().max(128).nullish(),
    defaultLocationId: z.string().max(128).nullish(),
    defaultLocale: z.enum(['tr', 'en']).default('tr'),
  })
  .superRefine((b, ctx) => {
    const need = (field: keyof typeof b) => {
      if (!b[field]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: 'required' });
    };
    if (b.provider === MailboxProvider.imap) (['imapHost', 'imapPort', 'username'] as const).forEach(need);
    if (b.provider === MailboxProvider.microsoft365) (['tenantId', 'clientId'] as const).forEach(need);
    if (b.provider === MailboxProvider.gmail) need('clientId');
    if (b.createTickets) (['defaultCategoryId', 'defaultLocationId'] as const).forEach(need);
  });

const mailboxSchema = z.object({
  id: z.string(),
  provider: z.nativeEnum(MailboxProvider),
  address: z.string(),
  isActive: z.boolean(),
  imapHost: z.string().nullable(),
  imapPort: z.number().nullable(),
  imapSecure: z.boolean(),
  username: z.string().nullable(),
  tenantId: z.string().nullable(),
  clientId: z.string().nullable(),
  hasSecret: z.boolean(),
  gmailConnected: z.boolean(),
  createTickets: z.boolean(),
  defaultCategoryId: z.string().nullable(),
  defaultLocationId: z.string().nullable(),
  defaultLocale: z.string(),
  lastFetchAt: z.date().nullable(),
  lastError: z.string().nullable(),
});

const inboundSchema = z.object({
  id: z.string(),
  fromEmail: z.string(),
  subject: z.string(),
  action: z.string(),
  reason: z.string().nullable(),
  ticketId: z.string().nullable(),
  receivedAt: z.date(),
});

const mailboxResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    mailbox: mailboxSchema.nullable(),
    recent: z.array(inboundSchema),
    /** Google Cloud Console'da "Authorized redirect URI" olarak girilecek adres. */
    googleRedirectUri: z.string(),
  }),
});

const OAUTH_STATE_TTL_SECONDS = 600;
const googleRedirectUri = () => `${config.CANONICAL_URL}/api/companies/mailbox/oauth/google/callback`;

type MailboxRow = Prisma.CompanyMailboxGetPayload<object>;

function toPublic(m: MailboxRow) {
  return {
    id: m.id,
    provider: m.provider,
    address: m.address,
    isActive: m.isActive,
    imapHost: m.imapHost,
    imapPort: m.imapPort,
    imapSecure: m.imapSecure,
    username: m.username,
    tenantId: m.tenantId,
    clientId: m.clientId,
    hasSecret: !!m.secretEnc,
    gmailConnected: !!m.refreshTokenEnc,
    createTickets: m.createTickets,
    defaultCategoryId: m.defaultCategoryId,
    defaultLocationId: m.defaultLocationId,
    defaultLocale: m.defaultLocale,
    lastFetchAt: m.lastFetchAt,
    lastError: m.lastError,
  };
}

export const mailboxRoutes: FastifyPluginAsyncZod = async (app) => {
  const adminOnly = [app.requireRole('admin')];

  async function loadView(companyId: string) {
    const mailbox = await app.prisma.companyMailbox.findUnique({ where: { companyId } });
    const recent = mailbox
      ? await app.prisma.inboundMessage.findMany({
          where: { mailboxId: mailbox.id },
          orderBy: { receivedAt: 'desc' },
          take: 20,
          select: { id: true, fromEmail: true, subject: true, action: true, reason: true, ticketId: true, receivedAt: true },
        })
      : [];
    return { mailbox: mailbox ? toPublic(mailbox) : null, recent, googleRedirectUri: googleRedirectUri() };
  }

  app.get('/:id/mailbox', {
    preValidation: adminOnly,
    schema: {
      params: idParamsSchema,
      tags: ['Companies'],
      summary: 'Şirket gelen posta kutusunu getir',
      response: { 200: mailboxResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    reply.send({ success: true, data: await loadView(request.params.id) });
  });

  app.put('/:id/mailbox', {
    preValidation: adminOnly,
    schema: {
      params: idParamsSchema,
      body: mailboxBodySchema,
      tags: ['Companies'],
      summary: 'Şirket gelen posta kutusunu kaydet',
      response: { 200: mailboxResponseSchema, ...commonErrorResponses, 409: errorResponseSchema },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body;

    const company = await app.prisma.company.findUnique({ where: { id }, select: { id: true } });
    if (!company) return reply.status(404).send({ success: false, error: t(request, 'companies.companyNotFound') });

    // SSRF: IMAP host'u admin girer, sunucu ona bağlanır (SMTP ile aynı kural).
    if (body.provider === MailboxProvider.imap) {
      try {
        await assertIntegrationHost(body.imapHost!, config.ALLOW_PRIVATE_INTEGRATION_HOSTS);
      } catch (err) {
        if (err instanceof BlockedHostError) {
          return reply.status(400).send({ success: false, error: t(request, 'companies.mailboxHostBlocked') });
        }
        throw err;
      }
    }

    // Varsayılan kategori/lokasyon bu şirkete (kategori için: ya da global) ait olmalı.
    if (body.defaultCategoryId) {
      const category = await app.prisma.category.findFirst({
        where: { id: body.defaultCategoryId, OR: [{ companyId: id }, { companyId: null }] },
        select: { id: true },
      });
      if (!category) return reply.status(400).send({ success: false, error: t(request, 'companies.mailboxInvalidDefaults') });
    }
    if (body.defaultLocationId) {
      const location = await app.prisma.location.findFirst({ where: { id: body.defaultLocationId, companyId: id }, select: { id: true } });
      if (!location) return reply.status(400).send({ success: false, error: t(request, 'companies.mailboxInvalidDefaults') });
    }

    const existing = await app.prisma.companyMailbox.findUnique({ where: { companyId: id } });
    if (!body.secret && !existing?.secretEnc) {
      return reply.status(400).send({ success: false, error: t(request, 'companies.mailboxSecretRequired') });
    }
    // Sağlayıcı / Google istemcisi değişirse eski Gmail yetkisi geçersizdir.
    const keepGmailToken =
      existing?.refreshTokenEnc &&
      existing.provider === MailboxProvider.gmail &&
      body.provider === MailboxProvider.gmail &&
      existing.clientId === body.clientId &&
      !body.secret;

    const { secret, ...rest } = body;
    const data = {
      ...rest,
      imapHost: rest.imapHost ?? null,
      imapPort: rest.imapPort ?? null,
      username: rest.username ?? null,
      tenantId: rest.tenantId ?? null,
      clientId: rest.clientId ?? null,
      defaultCategoryId: rest.defaultCategoryId ?? null,
      defaultLocationId: rest.defaultLocationId ?? null,
      ...(secret ? { secretEnc: encrypt(secret) } : {}),
      ...(keepGmailToken ? {} : { refreshTokenEnc: null }),
      lastError: null,
    };

    try {
      await app.prisma.companyMailbox.upsert({
        where: { companyId: id },
        create: { companyId: id, ...data },
        update: data,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.status(409).send({ success: false, error: t(request, 'companies.mailboxAddressInUse') });
      }
      throw err;
    }

    await createAuditLog({
      entityType: 'company_mailbox', entityId: id, action: 'update',
      changes: { provider: body.provider, address: body.address, isActive: body.isActive, createTickets: body.createTickets, secretChanged: !!secret },
      performedBy: request.staffUser!.email, ipAddress: request.headers['x-real-ip'] as string,
    });
    reply.send({ success: true, data: await loadView(id) });
  });

  app.delete('/:id/mailbox', {
    preValidation: adminOnly,
    schema: {
      params: idParamsSchema,
      tags: ['Companies'],
      summary: 'Şirket gelen posta kutusunu kaldır',
      response: { 200: successResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    await app.prisma.companyMailbox.deleteMany({ where: { companyId: id } });
    await createAuditLog({
      entityType: 'company_mailbox', entityId: id, action: 'delete', changes: {},
      performedBy: request.staffUser!.email, ipAddress: request.headers['x-real-ip'] as string,
    });
    reply.send({ success: true });
  });

  app.post('/:id/mailbox/test', {
    preValidation: adminOnly,
    schema: {
      params: idParamsSchema,
      tags: ['Companies'],
      summary: 'Gelen posta kutusu bağlantısını test et',
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ unreadSample: z.number() }) }),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    const mailbox = await app.prisma.companyMailbox.findUnique({ where: { companyId: request.params.id } });
    if (!mailbox) return reply.status(404).send({ success: false, error: t(request, 'companies.mailboxNotFound') });

    let source;
    try {
      if (mailbox.provider === MailboxProvider.imap) await assertIntegrationHost(mailbox.imapHost ?? '', config.ALLOW_PRIVATE_INTEGRATION_HOSTS);
      source = createMailSource(mailbox);
      // Test hiçbir iletiyi okundu işaretlemez; yalnızca bağlanıp listeler.
      const sample = await source.fetchUnread(5);
      return reply.send({ success: true, data: { unreadSample: sample.length } });
    } catch (err) {
      // IMAP: ayrıntılı hata (ECONNREFUSED/ETIMEDOUT) bir port tarayıcısı kâhinidir —
      // genel mesaj döner. M365/Gmail sabit bilinen uçlardır; sağlayıcının hata metni
      // (ör. "invalid_client") yapılandırmayı düzeltmek için gereklidir.
      const detail = mailbox.provider === MailboxProvider.imap ? '' : ` (${(err instanceof Error ? err.message : String(err)).slice(0, 300)})`;
      return reply.status(400).send({ success: false, error: t(request, 'companies.mailboxTestFailed') + detail });
    } finally {
      await source?.close().catch(() => undefined);
    }
  });

  // Gmail: OAuth onay ekranı adresini üretir. `state` Redis'te posta kutusuna bağlanır.
  app.post('/:id/mailbox/google/authorize', {
    preValidation: adminOnly,
    schema: {
      params: idParamsSchema,
      tags: ['Companies'],
      summary: 'Gmail posta kutusunu Google hesabıyla bağla',
      response: { 200: z.object({ success: z.literal(true), data: z.object({ url: z.string() }) }), ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const mailbox = await app.prisma.companyMailbox.findUnique({ where: { companyId: request.params.id } });
    if (!mailbox || mailbox.provider !== MailboxProvider.gmail || !mailbox.clientId || !mailbox.secretEnc) {
      return reply.status(400).send({ success: false, error: t(request, 'companies.mailboxGmailNotConfigured') });
    }
    const state = nanoid(32);
    await app.redis.set(`mailbox:oauth:${state}`, mailbox.id, 'EX', OAUTH_STATE_TTL_SECONDS);
    reply.send({ success: true, data: { url: googleAuthorizeUrl(mailbox.clientId, googleRedirectUri(), state, mailbox.address) } });
  });

  // Google'ın tarayıcıyı geri yönlendirdiği uç — oturum çerezi/JWT yoktur; yetki,
  // yalnızca admin'in başlattığı akışta üretilen tek kullanımlık `state` ile sağlanır.
  app.get('/mailbox/oauth/google/callback', {
    schema: {
      tags: ['Companies'],
      summary: 'Gmail OAuth geri dönüşü',
      querystring: z.object({
        code: z.string().max(2000).optional(),
        state: z.string().max(100).optional(),
        error: z.string().max(200).optional(),
      }),
    },
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const done = (result: 'connected' | 'error') => reply.redirect(`${config.CANONICAL_URL}/staff/companies?mailbox=${result}`);
    const { code, state } = request.query;
    if (!code || !state) return done('error');

    const key = `mailbox:oauth:${state}`;
    const mailboxId = await app.redis.get(key);
    await app.redis.del(key);
    if (!mailboxId) return done('error');

    const mailbox = await app.prisma.companyMailbox.findUnique({ where: { id: mailboxId } });
    if (!mailbox?.clientId || !mailbox.secretEnc) return done('error');
    try {
      const refreshToken = await exchangeGoogleCode({
        clientId: mailbox.clientId,
        clientSecret: decrypt(mailbox.secretEnc),
        redirectUri: googleRedirectUri(),
        code,
      });
      await app.prisma.companyMailbox.update({
        where: { id: mailbox.id },
        data: { refreshTokenEnc: encrypt(refreshToken), lastError: null },
      });
      await createAuditLog({
        entityType: 'company_mailbox', entityId: mailbox.companyId, action: 'gmail_connected', changes: { address: mailbox.address },
        performedBy: mailbox.address, ipAddress: request.headers['x-real-ip'] as string,
      });
      return done('connected');
    } catch (err) {
      request.log.warn({ err }, 'Gmail OAuth code exchange failed');
      return done('error');
    }
  });
};
