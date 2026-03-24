import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { paginationSchema, paginate, paginatedResponse } from '../../utils/pagination.js';

const reportFilterSchema = paginationSchema.extend({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  companyId: z.string().optional(),
  categoryId: z.string().optional(),
  assignedToId: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
});

export const reportRoutes: FastifyPluginAsync = async (app) => {
  // Ticket report with date filtering and aggregation
  app.get('/tickets', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const query = reportFilterSchema.parse(request.query);
    const { skip, take } = paginate(query);

    const where: any = {};
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo + 'T23:59:59Z');
    }
    if (query.companyId) where.companyId = query.companyId;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.assignedToId) where.assignedToId = query.assignedToId;
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;

    const [tickets, total] = await Promise.all([
      app.prisma.ticket.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          company: { select: { name: true } },
          location: { select: { name: true } },
          category: { select: { name: true } },
          assignedTo: { select: { fullName: true } },
        },
      }),
      app.prisma.ticket.count({ where }),
    ]);

    reply.send(paginatedResponse(tickets, total, query));
  });

  // Staff performance report
  app.get('/staff-performance', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const query = request.query as { dateFrom?: string; dateTo?: string };

    const dateFilter: any = {};
    if (query.dateFrom || query.dateTo) {
      dateFilter.createdAt = {};
      if (query.dateFrom) dateFilter.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) dateFilter.createdAt.lte = new Date(query.dateTo + 'T23:59:59Z');
    }

    const staff = await app.prisma.staff.findMany({
      where: { isActive: true },
      select: {
        id: true,
        fullName: true,
        role: true,
        assignedTickets: {
          where: dateFilter,
          select: {
            id: true,
            status: true,
            priority: true,
            slaResponseMet: true,
            slaResolveMet: true,
            createdAt: true,
            resolvedAt: true,
            firstRespondedAt: true,
          },
        },
      },
    });

    const performance = staff.map(s => {
      const total = s.assignedTickets.length;
      const resolved = s.assignedTickets.filter(t => t.status === 'resolved' || t.status === 'closed').length;
      const slaResponseMet = s.assignedTickets.filter(t => t.slaResponseMet === true).length;
      const slaResponseTotal = s.assignedTickets.filter(t => t.slaResponseMet !== null).length;
      const slaResolveMet = s.assignedTickets.filter(t => t.slaResolveMet === true).length;
      const slaResolveTotal = s.assignedTickets.filter(t => t.slaResolveMet !== null).length;

      // Average resolution time (hours)
      const resolvedTickets = s.assignedTickets.filter(t => t.resolvedAt);
      const avgResolutionHours = resolvedTickets.length > 0
        ? resolvedTickets.reduce((sum, t) => {
            const diff = new Date(t.resolvedAt!).getTime() - new Date(t.createdAt).getTime();
            return sum + diff / (1000 * 60 * 60);
          }, 0) / resolvedTickets.length
        : null;

      return {
        id: s.id,
        fullName: s.fullName,
        role: s.role,
        totalAssigned: total,
        resolved,
        open: total - resolved,
        slaResponseRate: slaResponseTotal > 0 ? Math.round((slaResponseMet / slaResponseTotal) * 100) : null,
        slaResolveRate: slaResolveTotal > 0 ? Math.round((slaResolveMet / slaResolveTotal) * 100) : null,
        avgResolutionHours: avgResolutionHours ? Math.round(avgResolutionHours * 10) / 10 : null,
      };
    });

    reply.send({ success: true, data: performance });
  });

  // Category breakdown report
  app.get('/categories', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const query = request.query as { dateFrom?: string; dateTo?: string };

    const dateFilter: any = {};
    if (query.dateFrom || query.dateTo) {
      dateFilter.createdAt = {};
      if (query.dateFrom) dateFilter.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) dateFilter.createdAt.lte = new Date(query.dateTo + 'T23:59:59Z');
    }

    const categories = await app.prisma.ticket.groupBy({
      by: ['categoryId'],
      where: dateFilter,
      _count: true,
    });

    const categoryIds = categories.map(c => c.categoryId);
    const categoryNames = await app.prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true },
    });
    const nameMap = new Map(categoryNames.map(c => [c.id, c.name]));

    const result = categories
      .map(c => ({
        categoryId: c.categoryId,
        categoryName: nameMap.get(c.categoryId) || 'Bilinmiyor',
        count: c._count,
      }))
      .sort((a, b) => b.count - a.count);

    reply.send({ success: true, data: result });
  });

  // CSV export
  app.get('/export/csv', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const query = request.query as { dateFrom?: string; dateTo?: string; companyId?: string };

    const where: any = {};
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo + 'T23:59:59Z');
    }
    if (query.companyId) where.companyId = query.companyId;

    const tickets = await app.prisma.ticket.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        company: { select: { name: true } },
        location: { select: { name: true } },
        category: { select: { name: true } },
        assignedTo: { select: { fullName: true } },
      },
    });

    const BOM = '\ufeff';
    const headers = ['Talep No', 'Konu', 'Şirket', 'Lokasyon', 'Kategori', 'Durum', 'Öncelik', 'Atanan', 'Oluşturan Email', 'Oluşturma Tarihi', 'Çözüm Tarihi'];
    const rows = tickets.map(t => [
      t.ticketNumber,
      `"${t.subject.replace(/"/g, '""')}"`,
      t.company.name,
      t.location.name,
      t.category.name,
      t.status,
      t.priority,
      t.assignedTo?.fullName || '',
      t.createdByEmail,
      new Date(t.createdAt).toLocaleString('tr-TR'),
      t.resolvedAt ? new Date(t.resolvedAt).toLocaleString('tr-TR') : '',
    ]);

    const csv = BOM + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');

    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="ticket-rapor-${new Date().toISOString().split('T')[0]}.csv"`)
      .send(csv);
  });
};
