import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { testSmtpConnection, invalidateCompanyTransporter } from '../../services/email.service.js';
import { createAuditLog } from '../../middleware/audit.js';
import { saveLogo, isAllowedLogoMimeType } from '../../services/storage.service.js';
import { getStaffCompanyScope, isCompanyInScope } from '../../utils/staff-scope.js';
import { encrypt } from '../../utils/crypto.js';

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
  groupType: z.string().min(1),
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

export const companyRoutes: FastifyPluginAsync = async (app) => {
  // List active companies (public)
  app.get('/', async (request, reply) => {
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
  app.get('/branding/by-host', async (request, reply) => {
    const q = z.object({ host: z.string().min(1) }).parse(request.query ?? {});
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
    preHandler: [app.requireRole('admin', 'it_manager')],
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
  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const company = await app.prisma.company.findUnique({
      where: { id },
      include: {
        locations: { where: { isActive: true }, orderBy: { name: 'asc' } },
        categories: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
        customFields: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!company) {
      return reply.status(404).send({ success: false, error: 'Şirket bulunamadı' });
    }
    reply.send({ success: true, data: company });
  });

  // Get company locations (public)
  app.get('/:id/locations', async (request, reply) => {
    const { id } = request.params as { id: string };
    const locations = await app.prisma.location.findMany({
      where: { companyId: id, isActive: true },
      orderBy: { name: 'asc' },
    });
    reply.send({ success: true, data: locations });
  });

  // Get company categories (public)
  app.get('/:id/categories', async (request, reply) => {
    const { id } = request.params as { id: string };
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
  app.get('/:id/custom-fields', async (request, reply) => {
    const { id } = request.params as { id: string };
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
    preHandler: [app.requireRole('admin')],
  }, async (request, reply) => {
    const body = companyCreateSchema.parse(request.body);
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
    preHandler: [app.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = companyUpdateSchema.parse(request.body);
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
    preHandler: [app.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await app.prisma.company.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ success: false, error: 'Şirket bulunamadı' });
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
    preHandler: [app.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await app.prisma.company.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ success: false, error: 'Şirket bulunamadı' });
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
    preHandler: [app.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

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
    preHandler: [app.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = smtpConfigSchema.parse(request.body);

    const company = await app.prisma.company.findUnique({ where: { id } });
    if (!company) {
      return reply.status(404).send({ success: false, error: 'Şirket bulunamadı' });
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
    preHandler: [app.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    await app.prisma.companySmtp.deleteMany({ where: { companyId: id } });
    invalidateCompanyTransporter(id);

    reply.send({ success: true, message: 'SMTP yapılandırması kaldırıldı, global SMTP kullanılacak' });
  });

  // Test company SMTP connection
  app.post('/:id/smtp/test', {
    preHandler: [app.requireRole('admin')],
  }, async (request, reply) => {
    const body = smtpConfigSchema.parse(request.body);

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
      reply.send({ success: true, message: 'SMTP bağlantısı başarılı' });
    } else {
      reply.status(400).send({ success: false, error: `SMTP bağlantısı başarısız: ${result.error}` });
    }
  });

  // Admin: Upload company logo
  app.post('/:id/logo', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const exists = await app.prisma.company.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return reply.status(404).send({ success: false, error: 'Şirket bulunamadı' });

    // it_manager yalnızca kendi şirketlerinin logosunu değiştirebilir.
    const staffUser = request.staffUser!;
    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    if (!isCompanyInScope(scope, id)) {
      return reply.status(403).send({ success: false, error: 'Bu şirket için yetkiniz yok' });
    }

    const file = await request.file();
    if (!file) return reply.status(400).send({ success: false, error: 'Dosya bulunamadı' });
    if (!isAllowedLogoMimeType(file.mimetype)) {
      return reply.status(400).send({ success: false, error: 'Sadece PNG, JPG, WEBP veya SVG yüklenebilir' });
    }
    const buffer = await file.toBuffer();
    if (buffer.length > 2 * 1024 * 1024) {
      return reply.status(400).send({ success: false, error: 'Dosya boyutu 2MB üzerinde olamaz' });
    }
    const saved = await saveLogo(buffer, file.filename, id);
    const updated = await app.prisma.company.update({
      where: { id },
      data: { logo: saved.url },
      select: { id: true, logo: true },
    });
    reply.send({ success: true, data: updated });
  });
};
