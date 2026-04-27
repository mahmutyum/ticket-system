import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getStaffCompanyScope, companyWhereClause } from '../../utils/staff-scope.js';

const dashboardFilterSchema = z.object({
  companyId: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  assignedToId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  onlyMine: z.enum(['true', 'false']).optional(),
});

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  // Dashboard stats — with filters and company scoping
  app.get('/stats', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const staffUser = request.staffUser!;
    const query = dashboardFilterSchema.parse(request.query);

    // Resolve company scope for this staff
    const scopeCompanyIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    const scopeWhere = companyWhereClause(scopeCompanyIds);

    // Build filter where clause
    const filterWhere: any = { ...scopeWhere };
    if (query.companyId) filterWhere.companyId = query.companyId;
    if (query.status) filterWhere.status = query.status;
    if (query.priority) filterWhere.priority = query.priority;
    if (query.assignedToId) filterWhere.assignedToId = query.assignedToId;
    if (query.onlyMine === 'true') filterWhere.assignedToId = staffUser.id;
    if (query.dateFrom || query.dateTo) {
      filterWhere.createdAt = {};
      if (query.dateFrom) filterWhere.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) filterWhere.createdAt.lte = new Date(query.dateTo + 'T23:59:59Z');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalOpen,
      totalInProgress,
      todayCreated,
      slaViolations,
      myOpen,
      byStatus,
      byPriority,
      byCompany,
      recentTickets,
    ] = await Promise.all([
      app.prisma.ticket.count({ where: { ...filterWhere, status: 'open' } }),
      app.prisma.ticket.count({ where: { ...filterWhere, status: 'in_progress' } }),
      app.prisma.ticket.count({ where: { ...filterWhere, createdAt: { gte: today } } }),
      app.prisma.ticket.count({
        where: {
          ...scopeWhere,
          OR: [
            { slaResponseDue: { lt: new Date() }, slaResponseMet: null, status: { notIn: ['resolved', 'closed'] } },
            { slaResolveDue: { lt: new Date() }, slaResolveMet: null, status: { notIn: ['resolved', 'closed'] } },
          ],
        },
      }),
      app.prisma.ticket.count({
        where: { ...scopeWhere, assignedToId: staffUser.id, status: { notIn: ['resolved', 'closed'] } },
      }),
      app.prisma.ticket.groupBy({
        by: ['status'],
        where: filterWhere,
        _count: true,
      }),
      app.prisma.ticket.groupBy({
        by: ['priority'],
        where: filterWhere,
        _count: true,
      }),
      app.prisma.ticket.groupBy({
        by: ['companyId'],
        where: filterWhere,
        _count: true,
        orderBy: { _count: { companyId: 'desc' } },
        take: 10,
      }),
      app.prisma.ticket.findMany({
        where: filterWhere,
        take: 15,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          ticketNumber: true,
          subject: true,
          status: true,
          priority: true,
          createdAt: true,
          company: { select: { name: true } },
          assignedTo: { select: { fullName: true } },
        },
      }),
    ]);

    const companyIds = byCompany.map(c => c.companyId);
    const companies = await app.prisma.company.findMany({
      where: { id: { in: companyIds } },
      select: { id: true, name: true },
    });
    const companyMap = new Map(companies.map(c => [c.id, c.name]));

    // Get all accessible companies for filter dropdown
    const accessibleCompanies = await app.prisma.company.findMany({
      where: scopeCompanyIds ? { id: { in: scopeCompanyIds }, isActive: true } : { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    reply.send({
      success: true,
      data: {
        summary: {
          totalOpen,
          totalInProgress,
          todayCreated,
          slaViolations,
          myOpen,
        },
        byStatus: byStatus.map(s => ({ status: s.status, count: s._count })),
        byPriority: byPriority.map(p => ({ priority: p.priority, count: p._count })),
        byCompany: byCompany.map(c => ({
          companyId: c.companyId,
          companyName: companyMap.get(c.companyId) || 'Bilinmiyor',
          count: c._count,
        })),
        recentTickets,
        accessibleCompanies,
      },
    });
  });

  // SLA report — scoped
  app.get('/sla', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const staffUser = request.staffUser!;
    const scopeCompanyIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    const scopeWhere = scopeCompanyIds ? { companyId: { in: scopeCompanyIds } } : {};

    const [totalWithSla, responseMet, responseViolated, resolveMet, resolveViolated] = await Promise.all([
      app.prisma.ticket.count({ where: { ...scopeWhere, slaResponseDue: { not: null } } }),
      app.prisma.ticket.count({ where: { ...scopeWhere, slaResponseMet: true } }),
      app.prisma.ticket.count({ where: { ...scopeWhere, slaResponseMet: false } }),
      app.prisma.ticket.count({ where: { ...scopeWhere, slaResolveMet: true } }),
      app.prisma.ticket.count({ where: { ...scopeWhere, slaResolveMet: false } }),
    ]);

    reply.send({
      success: true,
      data: {
        totalWithSla,
        response: {
          met: responseMet,
          violated: responseViolated,
          complianceRate: (responseMet + responseViolated) > 0
            ? Math.round((responseMet / (responseMet + responseViolated)) * 100)
            : 100,
        },
        resolution: {
          met: resolveMet,
          violated: resolveViolated,
          complianceRate: (resolveMet + resolveViolated) > 0
            ? Math.round((resolveMet / (resolveMet + resolveViolated)) * 100)
            : 100,
        },
      },
    });
  });

  // My assigned tickets
  app.get('/my-tickets', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const staffUser = request.staffUser!;
    const scopeCompanyIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    const scopeWhere = scopeCompanyIds ? { companyId: { in: scopeCompanyIds } } : {};

    const tickets = await app.prisma.ticket.findMany({
      where: {
        ...scopeWhere,
        assignedToId: staffUser.id,
        status: { notIn: ['resolved', 'closed'] },
      },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'asc' },
      ],
      include: {
        company: { select: { name: true } },
        category: { select: { name: true } },
      },
    });

    reply.send({ success: true, data: tickets });
  });
};
