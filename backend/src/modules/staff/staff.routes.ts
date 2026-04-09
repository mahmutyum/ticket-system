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
  // List staff (optionally filtered by company assignment)
  app.get('/', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { companyId } = request.query as { companyId?: string };

    const where: any = {};
    if (companyId) {
      // Staff assigned to this company OR admins/managers (who see all)
      where.OR = [
        { assignedCompanies: { some: { companyId } } },
        { role: { in: ['admin', 'it_manager'] } },
        // Staff with no assignments (unrestricted)
        { assignedCompanies: { none: {} }, role: 'it_staff' },
      ];
    }

    const staff = await app.prisma.staff.findMany({
      where: { ...where, isActive: true },
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
        assignedCompanies: {
          select: { companyId: true, company: { select: { name: true } } },
        },
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

    const auditChanges: Record<string, any> = { ...body };
    delete auditChanges.password;
    await createAuditLog({ entityType: 'staff', entityId: id, action: 'update', changes: auditChanges, performedBy: request.staffUser!.email, ipAddress: request.headers['x-real-ip'] as string });

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

    await createAuditLog({ entityType: 'staff', entityId: id, action: 'deactivate', performedBy: request.staffUser!.email, ipAddress: request.headers['x-real-ip'] as string });

    await app.redis.del(`refresh:${id}`);

    reply.send({ success: true });
  });

  // Update staff company assignments
  app.put('/:id/companies', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      companyIds: z.array(z.string().cuid()),
    }).parse(request.body);

    // Delete existing assignments and recreate
    await app.prisma.staffCompany.deleteMany({ where: { staffId: id } });

    if (body.companyIds.length > 0) {
      await app.prisma.staffCompany.createMany({
        data: body.companyIds.map(companyId => ({ staffId: id, companyId })),
      });
    }

    await createAuditLog({
      entityType: 'staff',
      entityId: id,
      action: 'company_assignment',
      changes: { companyIds: body.companyIds },
      performedBy: request.staffUser!.email,
      ipAddress: request.headers['x-real-ip'] as string,
    });

    reply.send({ success: true });
  });
};
