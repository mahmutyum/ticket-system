import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const companyCreateSchema = z.object({
  name: z.string().min(1),
  groupType: z.string().min(1),
  logo: z.string().optional(),
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
      },
    });
    reply.send({ success: true, data: companies });
  });
};
