import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getStaffCompanyScope, isCompanyInScope } from '../../utils/staff-scope.js';

const locationCreateSchema = z.object({
  companyId: z.string().cuid(),
  name: z.string().min(1),
  address: z.string().optional(),
  phone: z.string().optional(),
  floor: z.string().optional(),
  itRoom: z.string().optional(),
});

const locationUpdateSchema = locationCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const locationRoutes: FastifyPluginAsync = async (app) => {
  // Admin: Create location
  app.post('/', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const body = locationCreateSchema.parse(request.body);
    const staffUser = request.staffUser!;

    // Gövdedeki companyId istemciden gelir — kapsam içinde olmalı.
    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    if (!isCompanyInScope(scope, body.companyId)) {
      return reply.status(403).send({ success: false, error: 'Bu şirket için yetkiniz yok' });
    }

    const location = await app.prisma.location.create({ data: body });
    reply.status(201).send({ success: true, data: location });
  });

  // Admin: Update location
  app.put('/:id', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = locationUpdateSchema.parse(request.body);
    const staffUser = request.staffUser!;

    const existing = await app.prisma.location.findUnique({
      where: { id },
      select: { id: true, companyId: true },
    });
    if (!existing) return reply.status(404).send({ success: false, error: 'Lokasyon bulunamadı' });

    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);

    // Mevcut kayıt kapsam içinde mi?
    if (!isCompanyInScope(scope, existing.companyId)) {
      return reply.status(403).send({ success: false, error: 'Bu lokasyon için yetkiniz yok' });
    }
    // Hedef şirket de kapsam içinde mi? Yoksa lokasyon başka şirkete taşınabilir.
    if (body.companyId !== undefined && !isCompanyInScope(scope, body.companyId)) {
      return reply.status(403).send({
        success: false,
        error: 'Lokasyonu yetkili olmadığınız bir şirkete taşıyamazsınız',
      });
    }

    const location = await app.prisma.location.update({
      where: { id },
      data: body,
    });
    reply.send({ success: true, data: location });
  });

  // Admin: Soft delete
  app.delete('/:id', {
    preHandler: [app.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await app.prisma.location.update({
      where: { id },
      data: { isActive: false },
    });
    reply.send({ success: true });
  });
};
