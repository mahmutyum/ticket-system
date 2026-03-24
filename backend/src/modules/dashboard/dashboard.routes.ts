import { FastifyPluginAsync } from 'fastify';

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  // Dashboard stats
  app.get('/stats', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalOpen,
      totalInProgress,
      todayCreated,
      slaViolations,
      byStatus,
      byPriority,
      byCompany,
      recentTickets,
    ] = await Promise.all([
      app.prisma.ticket.count({ where: { status: 'open' } }),
      app.prisma.ticket.count({ where: { status: 'in_progress' } }),
      app.prisma.ticket.count({ where: { createdAt: { gte: today } } }),
      app.prisma.ticket.count({
        where: {
          OR: [
            { slaResponseDue: { lt: new Date() }, slaResponseMet: null, status: { notIn: ['resolved', 'closed'] } },
            { slaResolveDue: { lt: new Date() }, slaResolveMet: null, status: { notIn: ['resolved', 'closed'] } },
          ],
        },
      }),
      app.prisma.ticket.groupBy({
        by: ['status'],
        _count: true,
      }),
      app.prisma.ticket.groupBy({
        by: ['priority'],
        _count: true,
      }),
      app.prisma.ticket.groupBy({
        by: ['companyId'],
        _count: true,
        orderBy: { _count: { companyId: 'desc' } },
        take: 10,
      }),
      app.prisma.ticket.findMany({
        take: 10,
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

    // Get company names for byCompany stats
    const companyIds = byCompany.map(c => c.companyId);
    const companies = await app.prisma.company.findMany({
      where: { id: { in: companyIds } },
      select: { id: true, name: true },
    });
    const companyMap = new Map(companies.map(c => [c.id, c.name]));

    reply.send({
      success: true,
      data: {
        summary: {
          totalOpen,
          totalInProgress,
          todayCreated,
          slaViolations,
        },
        byStatus: byStatus.map(s => ({ status: s.status, count: s._count })),
        byPriority: byPriority.map(p => ({ priority: p.priority, count: p._count })),
        byCompany: byCompany.map(c => ({
          companyId: c.companyId,
          companyName: companyMap.get(c.companyId) || 'Bilinmiyor',
          count: c._count,
        })),
        recentTickets,
      },
    });
  });

  // SLA report
  app.get('/sla', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const [totalWithSla, responseMet, responseViolated, resolveMet, resolveViolated] = await Promise.all([
      app.prisma.ticket.count({ where: { slaResponseDue: { not: null } } }),
      app.prisma.ticket.count({ where: { slaResponseMet: true } }),
      app.prisma.ticket.count({ where: { slaResponseMet: false } }),
      app.prisma.ticket.count({ where: { slaResolveMet: true } }),
      app.prisma.ticket.count({ where: { slaResolveMet: false } }),
    ]);

    reply.send({
      success: true,
      data: {
        totalWithSla,
        response: {
          met: responseMet,
          violated: responseViolated,
          complianceRate: totalWithSla > 0
            ? Math.round((responseMet / (responseMet + responseViolated)) * 100)
            : 100,
        },
        resolution: {
          met: resolveMet,
          violated: resolveViolated,
          complianceRate: totalWithSla > 0
            ? Math.round((resolveMet / (resolveMet + resolveViolated)) * 100)
            : 100,
        },
      },
    });
  });

  // My assigned tickets (for current staff)
  app.get('/my-tickets', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const staffUser = request.staffUser!;

    const tickets = await app.prisma.ticket.findMany({
      where: {
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
