import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Prisma, CompanyGroupType } from '@prisma/client';
import { testSmtpConnection, invalidateCompanyTransporter } from '../../services/email.service.js';
import { createAuditLog } from '../../middleware/audit.js';
import { saveLogo, isAllowedLogoMimeType, isBufferConsistentWithMime } from '../../services/storage.service.js';
import { getStaffCompanyScope, isCompanyInScope } from '../../utils/staff-scope.js';
import { encrypt } from '../../utils/crypto.js';
import { assertPublicHost, BlockedHostError } from '../../utils/net-guard.js';
import { commonErrorResponses } from '../../utils/api-schema.js';
import { t } from '../../i18n/index.js';

const smtpConfigSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false),
  user: z.string().min(1),
  pass: z.string().min(1),
  fromName: z.string().min(1),
  fromEmail: z.string().email(),
  isActive: z.boolean().default(true),
});

const companyCreateSchema = z.object({
  name: z.string().min(1),
  groupType: z.nativeEnum(CompanyGroupType),
  logo: z.string().optional().nullable(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Geçerli hex renk değil').optional().nullable(),
  allowedDomains: z.array(z.string()).default([]),
  portalDomains: z.array(z.string()).default([]),
  notificationEmail: z.string().email().nullable().optional(),
  settings: z.record(z.unknown()).optional(),
});

const companyUpdateSchema = companyCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});
const idParamsSchema = z.object({ id: z.string().min(1).max(128) });
const brandingQuerySchema = z.object({ host: z.string().min(1).max(253) });
const publicCompanySchema = z.object({
  id: z.string(),
  name: z.string(),
  groupType: z.nativeEnum(CompanyGroupType),
  logo: z.string().nullable(),
  primaryColor: z.string().nullable(),
  allowedDomains: z.unknown(),
  portalDomains: z.unknown(),
});
const brandingSchema = z.object({
  id: z.string(),
  name: z.string(),
  logo: z.string().nullable(),
  primaryColor: z.string().nullable(),
});
const companySchema = publicCompanySchema.extend({
  notificationEmail: z.string().nullable(),
  isActive: z.boolean(),
  settings: z.unknown(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
const smtpSchema = z.object({
  id: z.string(),
  host: z.string(),
  port: z.number().int(),
  secure: z.boolean(),
  user: z.string(),
  fromName: z.string(),
  fromEmail: z.string().email(),
  isActive: z.boolean(),
});
const locationSchema = z.object({
  id: z.string(), companyId: z.string(), name: z.string(), address: z.string().nullable(),
  phone: z.string().nullable(), floor: z.string().nullable(), itRoom: z.string().nullable(),
  isActive: z.boolean(), createdAt: z.date(),
});
const categorySchema = z.object({
  id: z.string(), companyId: z.string().nullable(), name: z.string(), description: z.string().nullable(),
  parentId: z.string().nullable(), sortOrder: z.number().int(), isActive: z.boolean(),
  slaResponseMinutes: z.number().int().nullable(), slaResolutionMinutes: z.number().int().nullable(),
  autoAssignTo: z.string().nullable(), createdAt: z.date(),
});
const customFieldSchema = z.object({
  id: z.string(), companyId: z.string().nullable(), fieldName: z.string(), fieldLabel: z.string(),
  fieldType: z.string(), options: z.unknown(), required: z.boolean(), sortOrder: z.number().int(),
  isActive: z.boolean(), placeholder: z.string().nullable(), createdAt: z.date(),
});
const responseOf = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });
const messageResponseSchema = z.object({ success: z.literal(true), message: z.string() });

export const companyRoutes: FastifyPluginAsyncZod = async (app) => {
  // List active companies (public)
  app.get('/', { schema: {
    tags: ['Companies'],
    summary: 'Aktif şirketleri listele',
    response: { 200: responseOf(z.array(publicCompanySchema)), ...commonErrorResponses },
  } }, async (request, reply) => {
    const companies = await app.prisma.company.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        groupType: true,
        logo: true,
        primaryColor: true,
        allowedDomains: true,
        portalDomains: true,
      },
    });
    reply.send({ success: true, data: companies });
  });

  // Public: Get branding by host (portal domain match)
  app.get('/branding/by-host', { schema: {
    querystring: brandingQuerySchema,
    tags: ['Companies'],
    summary: 'Domain branding bilgisini getir',
    response: { 200: responseOf(brandingSchema.nullable()), ...commonErrorResponses },
  } }, async (request, reply) => {
    const q = request.query;
    const host = q.host.toLowerCase().split(':')[0];
    const companies = await app.prisma.company.findMany({
      where: { isActive: true },
      select: { id: true, name: true, logo: true, primaryColor: true, portalDomains: true },
    });
    const match = companies.find(c => {
      const domains = Array.isArray(c.portalDomains) ? (c.portalDomains as string[]) : [];
      return domains.some(d => typeof d === 'string' && d.toLowerCase() === host);
    });
    if (!match) return reply.send({ success: true, data: null });
    const { portalDomains, ...rest } = match;
    reply.send({ success: true, data: rest });
  });

  // Admin: List all companies (including inactive) — MUST be before /:id
  app.get('/admin/all', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: {
      tags: ['Companies'],
      summary: 'Yönetim için tüm şirketleri listele',
      response: {
        200: responseOf(z.array(companySchema.extend({
          _count: z.object({ locations: z.number().int(), tickets: z.number().int() }),
          locations: z.array(locationSchema), smtpConfig: smtpSchema.nullable(),
        }))),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    // it_manager yalnızca atandığı şirketleri görür. Bu uç nokta SMTP host/user
    // bilgisi de döndürdüğü için kapsamsız bırakılırsa çapraz şirket sızıntısı olur.
    const staffUser = request.staffUser!;
    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);

    const companies = await app.prisma.company.findMany({
      where: scope ? { id: { in: scope } } : {},
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { locations: true, tickets: true } },
        locations: {
          where: { isActive: true },
          orderBy: { name: 'asc' },
        },
        smtpConfig: {
          select: {
            id: true,
            host: true,
            port: true,
            secure: true,
            user: true,
            fromName: true,
            fromEmail: true,
            isActive: true,
          },
        },
      },
    });
    reply.send({ success: true, data: companies });
  });

  // Get company detail with locations and categories
  app.get('/:id', { schema: {
    params: idParamsSchema,
    tags: ['Companies'],
    summary: 'Şirket detayını getir',
    response: {
      200: responseOf(companySchema.extend({
        locations: z.array(locationSchema), categories: z.array(categorySchema),
        customFields: z.array(customFieldSchema),
      })),
      ...commonErrorResponses,
    },
  } }, async (request, reply) => {
    const { id } = request.params;
    const company = await app.prisma.company.findUnique({
      where: { id },
      include: {
        locations: { where: { isActive: true }, orderBy: { name: 'asc' } },
        categories: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
        customFields: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!company) {
      return reply.status(404).send({ success: false, error: t(request, 'companies.companyNotFound') });
    }
    reply.send({ success: true, data: company });
  });

  // Get company locations (public)
  app.get('/:id/locations', { schema: {
    params: idParamsSchema, tags: ['Companies'], summary: 'Şirket lokasyonlarını getir',
    response: { 200: responseOf(z.array(locationSchema)), ...commonErrorResponses },
  } }, async (request, reply) => {
    const { id } = request.params;
    const locations = await app.prisma.location.findMany({
      where: { companyId: id, isActive: true },
      orderBy: { name: 'asc' },
    });
    reply.send({ success: true, data: locations });
  });

  // Get company categories (public)
  app.get('/:id/categories', { schema: {
    params: idParamsSchema, tags: ['Companies'], summary: 'Şirket kategorilerini getir',
    response: { 200: responseOf(z.array(categorySchema)), ...commonErrorResponses },
  } }, async (request, reply) => {
    const { id } = request.params;
    const categories = await app.prisma.category.findMany({
      where: {
        OR: [{ companyId: id }, { companyId: null }],
        isActive: true,
      },
      orderBy: { sortOrder: 'asc' },
    });
    reply.send({ success: true, data: categories });
  });

  // Get company custom fields (public)
  app.get('/:id/custom-fields', { schema: {
    params: idParamsSchema, tags: ['Companies'], summary: 'Şirket özel alanlarını getir',
    response: { 200: responseOf(z.array(customFieldSchema)), ...commonErrorResponses },
  } }, async (request, reply) => {
    const { id } = request.params;
    const fields = await app.prisma.customField.findMany({
      where: {
        OR: [{ companyId: id }, { companyId: null }],
        isActive: true,
      },
      orderBy: { sortOrder: 'asc' },
    });
    reply.send({ success: true, data: fields });
  });

  // Admin: Create company
  app.post('/', {
    preValidation: [app.requireRole('admin')],
    schema: {
      body: companyCreateSchema,
      tags: ['Companies'],
      summary: 'Şirket oluştur',
      response: { 201: responseOf(companySchema), ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const body = request.body;
    const { settings, allowedDomains, portalDomains, ...rest } = body;
    const company = await app.prisma.company.create({
      data: {
        ...rest,
        allowedDomains: allowedDomains,
        portalDomains: portalDomains,
        ...(settings !== undefined ? { settings: settings as Prisma.InputJsonValue } : {}),
      },
    });
    await createAuditLog({ entityType: 'company', entityId: company.id, action: 'create', changes: { name: body.name, groupType: body.groupType }, performedBy: request.staffUser!.email, ipAddress: request.headers['x-real-ip'] as string });
    reply.status(201).send({ success: true, data: company });
  });

  // Admin: Update company
  app.put('/:id', {
    preValidation: [app.requireRole('admin')],
    schema: {
      params: idParamsSchema,
      body: companyUpdateSchema,
      tags: ['Companies'],
      summary: 'Şirket güncelle',
      response: { 200: responseOf(companySchema), ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body;
    const { settings, allowedDomains, portalDomains, ...rest } = body;
    const company = await app.prisma.company.update({
      where: { id },
      data: {
        ...rest,
        ...(allowedDomains !== undefined ? { allowedDomains: allowedDomains } : {}),
        ...(portalDomains !== undefined ? { portalDomains: portalDomains } : {}),
        ...(settings !== undefined ? { settings: settings as Prisma.InputJsonValue } : {}),
      },
    });
    await createAuditLog({ entityType: 'company', entityId: id, action: 'update', changes: body, performedBy: request.staffUser!.email, ipAddress: request.headers['x-real-ip'] as string });
    reply.send({ success: true, data: company });
  });

  // Admin: Soft-delete company (deactivate)
  app.delete('/:id', {
    preValidation: [app.requireRole('admin')],
    schema: {
      params: idParamsSchema,
      tags: ['Companies'],
      summary: 'Şirketi pasifleştir',
      response: { 200: responseOf(companySchema), ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const existing = await app.prisma.company.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ success: false, error: t(request, 'companies.companyNotFound') });
    }
    const company = await app.prisma.company.update({
      where: { id },
      data: { isActive: false },
    });
    await createAuditLog({ entityType: 'company', entityId: id, action: 'deactivate', changes: { name: existing.name }, performedBy: request.staffUser!.email, ipAddress: request.headers['x-real-ip'] as string });
    reply.send({ success: true, data: company });
  });

  // Admin: Restore soft-deleted company
  app.post('/:id/restore', {
    preValidation: [app.requireRole('admin')],
    schema: {
      params: idParamsSchema,
      tags: ['Companies'],
      summary: 'Şirketi yeniden etkinleştir',
      response: { 200: responseOf(companySchema), ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const existing = await app.prisma.company.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ success: false, error: t(request, 'companies.companyNotFound') });
    }
    const company = await app.prisma.company.update({
      where: { id },
      data: { isActive: true },
    });
    await createAuditLog({ entityType: 'company', entityId: id, action: 'restore', changes: { name: existing.name }, performedBy: request.staffUser!.email, ipAddress: request.headers['x-real-ip'] as string });
    reply.send({ success: true, data: company });
  });

  // ==================== COMPANY SMTP CONFIG ====================

  // Get company SMTP config
  app.get('/:id/smtp', {
    preValidation: [app.requireRole('admin')],
    schema: {
      params: idParamsSchema,
      tags: ['Companies'],
      summary: 'Şirket SMTP ayarını getir',
      response: {
        200: responseOf(smtpSchema.extend({ updatedAt: z.date() }).nullable()),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const smtp = await app.prisma.companySmtp.findUnique({
      where: { companyId: id },
      select: {
        id: true,
        host: true,
        port: true,
        secure: true,
        user: true,
        // pass excluded — return masked
        fromName: true,
        fromEmail: true,
        isActive: true,
        updatedAt: true,
      },
    });

    reply.send({ success: true, data: smtp });
  });

  // Create or update company SMTP config
  app.put('/:id/smtp', {
    preValidation: [app.requireRole('admin')],
    schema: {
      params: idParamsSchema,
      body: smtpConfigSchema,
      tags: ['Companies'],
      summary: 'Şirket SMTP ayarını güncelle',
      response: { 200: responseOf(smtpSchema), ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body;

    const company = await app.prisma.company.findUnique({ where: { id } });
    if (!company) {
      return reply.status(404).send({ success: false, error: t(request, 'companies.companyNotFound') });
    }

    // SSRF: host admin tarafından serbest yazılır ve sunucu ona bağlanır.
    // Dahili ağa (postgres:5432, redis:6379) veya bulut metadata'sına
    // yönlendirilmemeli. Kontrol DNS çözümlemesinden SONRA yapılır.
    try {
      await assertPublicHost(body.host);
    } catch (err) {
      if (err instanceof BlockedHostError) {
        return reply.status(400).send({
          success: false,
          error: t(request, 'companies.smtpHostBlocked'),
        });
      }
      throw err;
    }

    // SMTP şifresi veritabanına ŞİFRELİ yazılır (AES-256-GCM, CREDENTIALS_ENC_KEY).
    // Önceden düz metin tutuluyordu; okuma tarafı eski kayıtları formatından tanır.
    const data = { ...body, pass: encrypt(body.pass) };

    const smtp = await app.prisma.companySmtp.upsert({
      where: { companyId: id },
      create: { companyId: id, ...data },
      update: data,
    });

    invalidateCompanyTransporter(id);
    await createAuditLog({ entityType: 'company_smtp', entityId: id, action: 'update', changes: { host: body.host, fromEmail: body.fromEmail }, performedBy: request.staffUser!.email, ipAddress: request.headers['x-real-ip'] as string });

    reply.send({ success: true, data: {
      id: smtp.id,
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      user: smtp.user,
      fromName: smtp.fromName,
      fromEmail: smtp.fromEmail,
      isActive: smtp.isActive,
    }});
  });

  // Delete company SMTP config (revert to global)
  app.delete('/:id/smtp', {
    preValidation: [app.requireRole('admin')],
    schema: {
      params: idParamsSchema,
      tags: ['Companies'],
      summary: 'Şirket SMTP ayarını sil',
      response: { 200: messageResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    await app.prisma.companySmtp.deleteMany({ where: { companyId: id } });
    invalidateCompanyTransporter(id);

    reply.send({ success: true, message: t(request, 'companies.smtpRemoved') });
  });

  // Test company SMTP connection
  app.post('/:id/smtp/test', {
    preValidation: [app.requireRole('admin')],
    schema: {
      params: idParamsSchema,
      body: smtpConfigSchema,
      tags: ['Companies'],
      summary: 'Şirket SMTP bağlantısını test et',
      response: { 200: messageResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const body = request.body;

    // SSRF: bu uç gerçek bir TCP bağlantısı açar. Dahili ağa yönlendirilirse
    // bir port tarayıcısına dönüşür.
    try {
      await assertPublicHost(body.host);
    } catch (err) {
      if (err instanceof BlockedHostError) {
        return reply.status(400).send({
          success: false,
          error: t(request, 'companies.smtpHostBlocked'),
        });
      }
      throw err;
    }

    const result = await testSmtpConnection({
      host: body.host,
      port: body.port,
      secure: body.secure,
      user: body.user,
      pass: body.pass,
      fromName: body.fromName,
      fromEmail: body.fromEmail,
    });

    if (result.success) {
      reply.send({ success: true, message: t(request, 'companies.smtpTestSuccess') });
    } else {
      // Ham hata metni DÖNDÜRÜLMEZ.
      //
      // `ECONNREFUSED` / `ETIMEDOUT` / SMTP protokol yanıtı ayrımı, engel aşılsa
      // bile yarı-kör bir port tarayıcısı oracle'ı verir. Ayrıntı yalnızca sunucu
      // log'una yazılır; yöneticinin ihtiyacı olan bilgi "bağlanamadı"dır.
      app.log.warn({ host: body.host, port: body.port, err: result.error }, 'SMTP testi başarısız');
      reply.status(400).send({
        success: false,
        error: t(request, 'companies.smtpTestFailed'),
      });
    }
  });

  // Admin: Upload company logo
  app.post('/:id/logo', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: {
      params: idParamsSchema,
      tags: ['Companies'],
      summary: 'Şirket logosu yükle',
      response: {
        200: responseOf(z.object({ id: z.string(), logo: z.string().nullable() })),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const exists = await app.prisma.company.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return reply.status(404).send({ success: false, error: t(request, 'companies.companyNotFound') });

    // it_manager yalnızca kendi şirketlerinin logosunu değiştirebilir.
    const staffUser = request.staffUser!;
    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    if (!isCompanyInScope(scope, id)) {
      return reply.status(403).send({ success: false, error: t(request, 'companies.companyForbidden') });
    }

    const file = await request.file();
    if (!file) return reply.status(400).send({ success: false, error: t(request, 'companies.fileNotFound') });
    if (!isAllowedLogoMimeType(file.mimetype)) {
      return reply.status(400).send({ success: false, error: t(request, 'companies.logoMimeNotAllowed') });
    }
    const buffer = await file.toBuffer();
    if (buffer.length > 2 * 1024 * 1024) {
      return reply.status(400).send({ success: false, error: t(request, 'companies.fileTooLarge') });
    }
    // Beyan edilen logo tipi gerçek imzayla tutarlı mı (webp/png/jpg).
    if (!isBufferConsistentWithMime(buffer, file.mimetype)) {
      return reply.status(400).send({ success: false, error: t(request, 'companies.fileMimeMismatch') });
    }
    const saved = await saveLogo(buffer, file.filename, id, file.mimetype);
    const updated = await app.prisma.company.update({
      where: { id },
      data: { logo: saved.url },
      select: { id: true, logo: true },
    });
    reply.send({ success: true, data: updated });
  });
};
