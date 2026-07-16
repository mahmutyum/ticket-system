import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createAuditLog } from '../../middleware/audit.js';
import { getStaffCompanyScope, isCompanyInScope } from '../../utils/staff-scope.js';
import { commonErrorResponses, successResponseSchema } from '../../utils/api-schema.js';

const categoryCreateSchema = z.object({
  companyId: z.string().cuid().nullable().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  parentId: z.string().cuid().nullable().optional(),
  sortOrder: z.number().int().default(0),
  slaResponseMinutes: z.number().int().positive().optional(),
  slaResolutionMinutes: z.number().int().positive().optional(),
  autoAssignTo: z.string().cuid().optional(),
});

const categoryUpdateSchema = categoryCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});
const idParamsSchema = z.object({ id: z.string().min(1).max(128) });
const reorderSchema = z.array(z.object({ id: z.string().cuid(), sortOrder: z.number().int() }));
const categorySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  companyId: z.string().nullable(),
});
const categorySchema = categorySummarySchema.extend({
  description: z.string().nullable(),
  parentId: z.string().nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  slaResponseMinutes: z.number().int().nullable(),
  slaResolutionMinutes: z.number().int().nullable(),
  autoAssignTo: z.string().nullable(),
  createdAt: z.date(),
});
const categoryResponseSchema = z.object({ success: z.literal(true), data: categorySchema });

export const categoryRoutes: FastifyPluginAsyncZod = async (app) => {
  // Staff: tüm aktif kategorileri listele (raporlar filtre dropdown'ı için)
  app.get('/', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Categories'],
      summary: 'Aktif kategorileri listele',
      response: {
        200: z.object({ success: z.literal(true), data: z.array(categorySummarySchema) }),
        ...commonErrorResponses,
      },
    },
  }, async (_request, reply) => {
    const categories = await app.prisma.category.findMany({
      where: { isActive: true },
      select: { id: true, name: true, companyId: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    reply.send({ success: true, data: categories });
  });

  // Admin: Reorder — MUST be before /:id
  app.put('/reorder', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: {
      body: reorderSchema,
      tags: ['Categories'],
      summary: 'Kategori sırasını güncelle',
      response: { 200: successResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const body = request.body;

    // Sıralanan kategorilerin TAMAMI kapsam içinde olmalı — id listesi
    // istemciden geliyor ve şirket bilgisi taşımıyor.
    const staffUser = request.staffUser!;
    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    if (scope !== null) {
      const targets = await app.prisma.category.findMany({
        where: { id: { in: body.map((i) => i.id) } },
        select: { id: true, companyId: true },
      });
      const denied = targets.some((c) => !isCompanyInScope(scope, c.companyId));
      if (denied || targets.length !== body.length) {
        return reply.status(403).send({
          success: false,
          error: 'Yetkili olmadığınız kategorileri sıralayamazsınız',
        });
      }
    }

    await app.prisma.$transaction(
      body.map(item =>
        app.prisma.category.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        })
      )
    );

    await createAuditLog({
      entityType: 'category',
      entityId: 'bulk',
      action: 'reorder',
      changes: { count: body.length },
      performedBy: request.staffUser!.email,
      ipAddress: request.headers['x-real-ip'] as string,
    });

    reply.send({ success: true });
  });

  // Admin: Create category
  app.post('/', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: {
      body: categoryCreateSchema,
      tags: ['Categories'],
      summary: 'Kategori oluştur',
      response: { 201: categoryResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const body = request.body;
    const staffUser = request.staffUser!;

    // companyId null ise "global" kategori (tüm şirketlere açık) — yalnızca admin.
    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    if (!isCompanyInScope(scope, body.companyId)) {
      return reply.status(403).send({ success: false, error: 'Bu şirket için yetkiniz yok' });
    }

    const category = await app.prisma.category.create({
      data: body,
    });
    reply.status(201).send({ success: true, data: category });
  });

  // Admin: Update category
  app.put('/:id', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: {
      params: idParamsSchema,
      body: categoryUpdateSchema,
      tags: ['Categories'],
      summary: 'Kategori güncelle',
      response: { 200: categoryResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body;
    const staffUser = request.staffUser!;

    const existing = await app.prisma.category.findUnique({
      where: { id },
      select: { id: true, companyId: true },
    });
    if (!existing) return reply.status(404).send({ success: false, error: 'Kategori bulunamadı' });

    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    if (!isCompanyInScope(scope, existing.companyId)) {
      return reply.status(403).send({ success: false, error: 'Bu kategori için yetkiniz yok' });
    }
    if (body.companyId !== undefined && !isCompanyInScope(scope, body.companyId)) {
      return reply.status(403).send({
        success: false,
        error: 'Kategoriyi yetkili olmadığınız bir şirkete taşıyamazsınız',
      });
    }

    const category = await app.prisma.category.update({
      where: { id },
      data: body,
    });
    reply.send({ success: true, data: category });
  });

  // Admin: Soft delete
  app.delete('/:id', {
    preValidation: [app.requireRole('admin')],
    schema: {
      params: idParamsSchema,
      tags: ['Categories'],
      summary: 'Kategoriyi pasifleştir',
      response: { 200: successResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    await app.prisma.category.update({
      where: { id },
      data: { isActive: false },
    });
    reply.send({ success: true });
  });
};
