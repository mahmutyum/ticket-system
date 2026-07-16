import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getStaffCompanyScope, isCompanyInScope } from '../../utils/staff-scope.js';
import { commonErrorResponses, successResponseSchema } from '../../utils/api-schema.js';

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
const idParamsSchema = z.object({ id: z.string().min(1).max(128) });
const locationSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  floor: z.string().nullable(),
  itRoom: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.date(),
});
const locationResponseSchema = z.object({ success: z.literal(true), data: locationSchema });

export const locationRoutes: FastifyPluginAsyncZod = async (app) => {
  // Admin: Create location
  app.post('/', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: {
      body: locationCreateSchema,
      tags: ['Locations'],
      summary: 'Lokasyon oluştur',
      response: { 201: locationResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const body = request.body;
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
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: {
      params: idParamsSchema,
      body: locationUpdateSchema,
      tags: ['Locations'],
      summary: 'Lokasyon güncelle',
      response: { 200: locationResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body;
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
    preValidation: [app.requireRole('admin')],
    schema: {
      params: idParamsSchema,
      tags: ['Locations'],
      summary: 'Lokasyonu pasifleştir',
      response: { 200: successResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    await app.prisma.location.update({
      where: { id },
      data: { isActive: false },
    });
    reply.send({ success: true });
  });
};
