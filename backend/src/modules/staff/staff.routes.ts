import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { createAuditLog } from '../../middleware/audit.js';

const staffCreateSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(['admin', 'it_manager', 'it_staff']),
  department: z.string().optional(),
  phone: z.string().optional(),
});

const staffUpdateSchema = z.object({
  fullName: z.string().min(1).optional(),
  role: z.enum(['admin', 'it_manager', 'it_staff']).optional(),
  department: z.string().optional(),
  phone: z.string().optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

export const staffRoutes: FastifyPluginAsync = async (app) => {
  // List staff
  app.get('/', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const staff = await app.prisma.staff.findMany({
      orderBy: { fullName: 'asc' },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        department: true,
        phone: true,
        isActive: true,
        avatarUrl: true,
        createdAt: true,
        _count: { select: { assignedTickets: true } },
      },
    });
    reply.send({ success: true, data: staff });
  });

  // Create staff
  app.post('/', {
    preHandler: [app.requireRole('admin')],
  }, async (request, reply) => {
    const body = staffCreateSchema.parse(request.body);
    const passwordHash = await bcrypt.hash(body.password, 12);

    const staff = await app.prisma.staff.create({
      data: {
        email: body.email,
        fullName: body.fullName,
        passwordHash,
        role: body.role,
        department: body.department,
        phone: body.phone,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        department: true,
      },
    });

    await createAuditLog({
      entityType: 'staff',
      entityId: staff.id,
      action: 'create',
      changes: { email: body.email, role: body.role },
      performedBy: request.staffUser!.email,
      ipAddress: request.headers['x-real-ip'] as string,
    });

    reply.status(201).send({ success: true, data: staff });
  });

  // Update staff
  app.put('/:id', {
    preHandler: [app.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = staffUpdateSchema.parse(request.body);

    const updateData: any = { ...body };
    if (body.password) {
      updateData.passwordHash = await bcrypt.hash(body.password, 12);
      delete updateData.password;

      // Invalidate refresh tokens
      await app.redis.del(`refresh:${id}`);
    }

    const staff = await app.prisma.staff.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        department: true,
        phone: true,
        isActive: true,
      },
    });

    reply.send({ success: true, data: staff });
  });

  // Deactivate staff
  app.delete('/:id', {
    preHandler: [app.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    await app.prisma.staff.update({
      where: { id },
      data: { isActive: false },
    });

    await app.redis.del(`refresh:${id}`);

    reply.send({ success: true });
  });
};
