import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { FIELD_TYPES } from '../../config/constants.js';
import { getStaffCompanyScope, isCompanyInScope } from '../../utils/staff-scope.js';

const customFieldCreateSchema = z.object({
  companyId: z.string().cuid().nullable().optional(),
  fieldName: z.string().min(1),
  fieldLabel: z.string().min(1),
  fieldType: z.enum(FIELD_TYPES),
  options: z.array(z.string()).optional(),
  required: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  placeholder: z.string().optional(),
});

const customFieldUpdateSchema = customFieldCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const customFieldRoutes: FastifyPluginAsync = async (app) => {
  // Admin: Create custom field
  app.post('/', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const body = customFieldCreateSchema.parse(request.body);
    const staffUser = request.staffUser!;

    // companyId null ise "global" alan (tüm şirketlerin formuna çıkar) — yalnızca admin.
    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    if (!isCompanyInScope(scope, body.companyId)) {
      return reply.status(403).send({ success: false, error: 'Bu şirket için yetkiniz yok' });
    }

    const field = await app.prisma.customField.create({ data: body });
    reply.status(201).send({ success: true, data: field });
  });

  // Admin: Update custom field
  app.put('/:id', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = customFieldUpdateSchema.parse(request.body);
    const staffUser = request.staffUser!;

    const existing = await app.prisma.customField.findUnique({
      where: { id },
      select: { id: true, companyId: true },
    });
    if (!existing) return reply.status(404).send({ success: false, error: 'Alan bulunamadı' });

    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    if (!isCompanyInScope(scope, existing.companyId)) {
      return reply.status(403).send({ success: false, error: 'Bu alan için yetkiniz yok' });
    }
    if (body.companyId !== undefined && !isCompanyInScope(scope, body.companyId)) {
      return reply.status(403).send({
        success: false,
        error: 'Alanı yetkili olmadığınız bir şirkete taşıyamazsınız',
      });
    }

    const field = await app.prisma.customField.update({
      where: { id },
      data: body,
    });
    reply.send({ success: true, data: field });
  });

  // Admin: Delete
  app.delete('/:id', {
    preHandler: [app.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await app.prisma.customField.update({
      where: { id },
      data: { isActive: false },
    });
    reply.send({ success: true });
  });
};
