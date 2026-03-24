import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

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
    const location = await app.prisma.location.create({ data: body });
    reply.status(201).send({ success: true, data: location });
  });

  // Admin: Update location
  app.put('/:id', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = locationUpdateSchema.parse(request.body);
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
