import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createAuditLog } from '../../middleware/audit.js';

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

export const categoryRoutes: FastifyPluginAsync = async (app) => {
  // Admin: Reorder — MUST be before /:id
  app.put('/reorder', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const body = z.array(z.object({
      id: z.string().cuid(),
      sortOrder: z.number().int(),
    })).parse(request.body);

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
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const body = categoryCreateSchema.parse(request.body);
    const category = await app.prisma.category.create({
      data: body,
    });
    reply.status(201).send({ success: true, data: category });
  });

  // Admin: Update category
  app.put('/:id', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = categoryUpdateSchema.parse(request.body);
    const category = await app.prisma.category.update({
      where: { id },
      data: body,
    });
    reply.send({ success: true, data: category });
  });

  // Admin: Soft delete
  app.delete('/:id', {
    preHandler: [app.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await app.prisma.category.update({
      where: { id },
      data: { isActive: false },
    });
    reply.send({ success: true });
  });
};
