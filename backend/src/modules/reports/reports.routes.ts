import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { paginationSchema, paginate, paginatedResponse } from '../../utils/pagination.js';
import { getStaffCompanyScope, companyWhereClause } from '../../utils/staff-scope.js';

const reportFilterSchema = paginationSchema.extend({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  companyId: z.string().optional(),
  categoryId: z.string().optional(),
  assignedToId: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
});

type CommonFilters = {
  dateFrom?: string;
  dateTo?: string;
  companyId?: string;
  categoryId?: string;
  assignedToId?: string;
  priority?: string;
  status?: string;
};

function buildTicketWhere(filters: CommonFilters, scopeCompanyIds: string[] | null): any {
  const where: any = {};
  if (scopeCompanyIds) where.companyId = { in: scopeCompanyIds };
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {};
    if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
    if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo + 'T23:59:59Z');
  }
  if (filters.companyId) where.companyId = filters.companyId;
  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.assignedToId) where.assignedToId = filters.assignedToId;
  if (filters.priority) where.priority = filters.priority;
  if (filters.status) where.status = filters.status;
  return where;
}

function csvEscape(value: string | null | undefined): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes('"') || str.includes(';') || str.includes('\n') || /^[=+\-@]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export const reportRoutes: FastifyPluginAsync = async (app) => {
  // Ticket report with date filtering and aggregation
  app.get('/tickets', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const query = reportFilterSchema.parse(request.query);
    const { skip, take } = paginate(query);
    const staffUser = request.staffUser!;

    const scopeCompanyIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    const scopeWhere = companyWhereClause(scopeCompanyIds);

    const where: any = { ...scopeWhere };
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
    const query = request.query as CommonFilters;
    const staffUser = request.staffUser!;

    const scopeCompanyIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    const dateFilter = buildTicketWhere(query, scopeCompanyIds);

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
    const query = request.query as CommonFilters;
    const staffUser = request.staffUser!;

    const scopeCompanyIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    const where = buildTicketWhere(query, scopeCompanyIds);

    const categories = await app.prisma.ticket.groupBy({
      by: ['categoryId'],
      where,
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
    const query = request.query as CommonFilters;
    const staffUser = request.staffUser!;

    const scopeCompanyIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    const where = buildTicketWhere(query, scopeCompanyIds);

    const tickets = await app.prisma.ticket.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10000,
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
      csvEscape(t.ticketNumber),
      csvEscape(t.subject),
      csvEscape(t.company.name),
      csvEscape(t.location?.name),
      csvEscape(t.category.name),
      csvEscape(t.status),
      csvEscape(t.priority),
      csvEscape(t.assignedTo?.fullName),
      csvEscape(t.createdByEmail),
      csvEscape(new Date(t.createdAt).toLocaleString('tr-TR')),
      csvEscape(t.resolvedAt ? new Date(t.resolvedAt).toLocaleString('tr-TR') : ''),
    ]);

    const csv = BOM + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');

    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="ticket-rapor-${new Date().toISOString().split('T')[0]}.csv"`)
      .send(csv);
  });

  // Zaman serisi overview: günlük / haftalık / aylık bucket'larda created/resolved/inProgress/overdue
  app.get('/overview', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const query = request.query as CommonFilters & { period?: 'daily' | 'weekly' | 'monthly' };
    const period = query.period === 'weekly' ? 'week' : query.period === 'monthly' ? 'month' : 'day';
    const staffUser = request.staffUser!;

    const scopeCompanyIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    const where = buildTicketWhere(query, scopeCompanyIds);

    const tickets = await app.prisma.ticket.findMany({
      where,
      select: {
        createdAt: true,
        status: true,
        resolvedAt: true,
        slaResolveMet: true,
      },
      take: 50000,
    });

    const bucketKey = (d: Date): string => {
      const x = new Date(d);
      if (period === 'day') {
        return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
      }
      if (period === 'month') {
        return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01`;
      }
      // week: ISO Pazartesi
      const day = x.getDay();
      const offset = day === 0 ? -6 : 1 - day;
      x.setDate(x.getDate() + offset);
      x.setHours(0, 0, 0, 0);
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    };

    const buckets = new Map<string, { bucket: string; created: number; resolved: number; inProgress: number; overdue: number }>();
    const ensure = (key: string) => {
      let b = buckets.get(key);
      if (!b) {
        b = { bucket: key, created: 0, resolved: 0, inProgress: 0, overdue: 0 };
        buckets.set(key, b);
      }
      return b;
    };

    tickets.forEach((t) => {
      const created = ensure(bucketKey(new Date(t.createdAt)));
      created.created += 1;
      if (t.status === 'in_progress') created.inProgress += 1;
      if (t.slaResolveMet === false) created.overdue += 1;
      if (t.resolvedAt) {
        const r = ensure(bucketKey(new Date(t.resolvedAt)));
        r.resolved += 1;
      }
    });

    const data = Array.from(buckets.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));
    reply.send({ success: true, data, period });
  });

  // SLA trend serisi
  app.get('/sla-trends', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const query = request.query as CommonFilters & { period?: 'weekly' | 'monthly' };
    const period = query.period === 'monthly' ? 'month' : 'week';
    const staffUser = request.staffUser!;

    const scopeCompanyIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    const where = buildTicketWhere(query, scopeCompanyIds);

    const tickets = await app.prisma.ticket.findMany({
      where,
      select: {
        createdAt: true,
        slaResponseMet: true,
        slaResolveMet: true,
      },
      take: 50000,
    });

    const bucketKey = (d: Date): string => {
      const x = new Date(d);
      if (period === 'month') {
        return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01`;
      }
      const day = x.getDay();
      const offset = day === 0 ? -6 : 1 - day;
      x.setDate(x.getDate() + offset);
      x.setHours(0, 0, 0, 0);
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    };

    const buckets = new Map<string, {
      bucket: string;
      total: number;
      responseMet: number;
      responseTotal: number;
      resolveMet: number;
      resolveTotal: number;
    }>();
    const ensure = (key: string) => {
      let b = buckets.get(key);
      if (!b) {
        b = { bucket: key, total: 0, responseMet: 0, responseTotal: 0, resolveMet: 0, resolveTotal: 0 };
        buckets.set(key, b);
      }
      return b;
    };

    tickets.forEach((t) => {
      const b = ensure(bucketKey(new Date(t.createdAt)));
      b.total += 1;
      if (t.slaResponseMet !== null) {
        b.responseTotal += 1;
        if (t.slaResponseMet) b.responseMet += 1;
      }
      if (t.slaResolveMet !== null) {
        b.resolveTotal += 1;
        if (t.slaResolveMet) b.resolveMet += 1;
      }
    });

    const data = Array.from(buckets.values())
      .map((b) => ({
        bucket: b.bucket,
        total: b.total,
        responseMet: b.responseMet,
        resolveMet: b.resolveMet,
        responseRate: b.responseTotal > 0 ? Math.round((b.responseMet / b.responseTotal) * 100) : null,
        resolveRate: b.resolveTotal > 0 ? Math.round((b.resolveMet / b.resolveTotal) * 100) : null,
      }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket));

    reply.send({ success: true, data, period });
  });
};
