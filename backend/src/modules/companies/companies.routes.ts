import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { testSmtpConnection, invalidateCompanyTransporter } from '../../services/email.service.js';
import { createAuditLog } from '../../middleware/audit.js';

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
  logo: z.string().optional(),
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
        allowedDomains: true,
        portalDomains: true,
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
    const company = await app.prisma.company.create({ data: body });
    await createAuditLog({ entityType: 'company', entityId: company.id, action: 'create', changes: { name: body.name, groupType: body.groupType }, performedBy: request.staffUser!.email, ipAddress: request.headers['x-real-ip'] as string });
    reply.status(201).send({ success: true, data: company });
  });

  // Admin: Update company
  app.put('/:id', {
    preHandler: [app.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = companyUpdateSchema.parse(request.body);
    const company = await app.prisma.company.update({
      where: { id },
      data: body,
    });
    await createAuditLog({ entityType: 'company', entityId: id, action: 'update', changes: body, performedBy: request.staffUser!.email, ipAddress: request.headers['x-real-ip'] as string });
    reply.send({ success: true, data: company });
  });

  // Admin: List all companies (including inactive)
  app.get('/admin/all', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const companies = await app.prisma.company.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { locations: true, tickets: true } },
        smtpConfig: {
          select: {
            id: true,
            host: true,
            port: true,
            secure: true,
            user: true,
            // pass deliberately excluded from list response
            fromName: true,
            fromEmail: true,
            isActive: true,
          },
        },
      },
    });
    reply.send({ success: true, data: companies });
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

    const smtp = await app.prisma.companySmtp.upsert({
      where: { companyId: id },
      create: { companyId: id, ...body },
      update: body,
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
};
