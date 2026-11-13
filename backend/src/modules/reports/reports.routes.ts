import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Prisma, PrismaClient, Priority, TicketStatus } from '@prisma/client';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { paginationSchema, paginate, paginatedResponse } from '../../utils/pagination.js';
import { getStaffCompanyScope, resolveCompanyFilter } from '../../utils/staff-scope.js';
import { commonErrorResponses } from '../../utils/api-schema.js';

const reportFilterSchema = paginationSchema.extend({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  companyId: z.string().optional(),
  categoryId: z.string().optional(),
  assignedToId: z.string().optional(),
  status: z.nativeEnum(TicketStatus).optional(),
  priority: z.nativeEnum(Priority).optional(),
});
const commonReportFilterSchema = reportFilterSchema.omit({ page: true, limit: true });
const overviewFilterSchema = commonReportFilterSchema.extend({ period: z.enum(['daily', 'weekly', 'monthly']).optional() });
const slaTrendFilterSchema = commonReportFilterSchema.extend({ period: z.enum(['weekly', 'monthly']).optional() });
const reportTicketSchema = z.object({
  id: z.string(), ticketNumber: z.string(), subject: z.string(), status: z.nativeEnum(TicketStatus),
  priority: z.nativeEnum(Priority), createdByEmail: z.string().email(), createdAt: z.date(),
  resolvedAt: z.date().nullable(), slaResponseMet: z.boolean().nullable(), slaResolveMet: z.boolean().nullable(),
  company: z.object({ name: z.string() }), location: z.object({ name: z.string() }),
  category: z.object({ name: z.string() }), assignedTo: z.object({ fullName: z.string() }).nullable(),
});
const responseOf = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });
const performanceSchema = z.object({
  id: z.string(), fullName: z.string(), role: z.string(), totalAssigned: z.number().int(),
  resolved: z.number().int(), open: z.number().int(), slaResponseRate: z.number().int().nullable(),
  slaResolveRate: z.number().int().nullable(), avgResolutionHours: z.number().nullable(),
});
const categoryReportSchema = z.object({
  categoryId: z.string(), categoryName: z.string(), count: z.number().int(),
});
const overviewBucketSchema = z.object({
  bucket: z.string(), created: z.number().int(), resolved: z.number().int(),
  inProgress: z.number().int(), overdue: z.number().int(),
});
const slaTrendSchema = z.object({
  bucket: z.string(), total: z.number().int(), responseMet: z.number().int(), resolveMet: z.number().int(),
  responseRate: z.number().int().nullable(), resolveRate: z.number().int().nullable(),
});

const breakdownRowSchema = z.object({ id: z.string().nullable(), name: z.string().nullable(), count: z.number().int(), average: z.number().nullable() });
const satisfactionReportSchema = z.object({
  count: z.number().int(),
  average: z.number().nullable(),
  surveysSent: z.number().int(),
  responseRate: z.number().int().nullable(),
  distribution: z.array(z.object({ rating: z.number().int(), count: z.number().int() })),
  byStaff: z.array(breakdownRowSchema),
  byCategory: z.array(breakdownRowSchema),
  byCompany: z.array(breakdownRowSchema),
  recentComments: z.array(z.object({ ticketId: z.string(), ticketNumber: z.string(), rating: z.number().int(), comment: z.string(), at: z.date().nullable() })),
});

type CommonFilters = {
  dateFrom?: string;
  dateTo?: string;
  companyId?: string;
  categoryId?: string;
  assignedToId?: string;
  priority?: Priority;
  status?: TicketStatus;
};

function buildTicketWhere(filters: CommonFilters, scopeCompanyIds: string[] | null): Prisma.TicketWhereInput {
  // companyId filtresi kapsamla kesiştirilir — doğrudan atanırsa kapsamı ezer
  // ve ?companyId=<başka-şirket> ile yetki aşımına açık hale gelir.
  const where: Prisma.TicketWhereInput = { ...resolveCompanyFilter(scopeCompanyIds, filters.companyId) };
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {};
    if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
    if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo + 'T23:59:59Z');
  }
  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.assignedToId) where.assignedToId = filters.assignedToId;
  if (filters.priority) where.priority = filters.priority;
  if (filters.status) where.status = filters.status;
  return where;
}

/**
 * Bir CSV alanını hem ÇERÇEVELEME hem FORMÜL enjeksiyonuna karşı güvenli hale getirir.
 *
 * Bu ikisi ayrı sorundur ve ayrı çareleri vardır — önceki hali formül riskini
 * doğru tespit edip yanlış çareyi uyguluyordu:
 *
 * - **Çerçeveleme** (`"`, `;`, satır sonu): alanı tırnak içine al, içerideki
 *   tırnakları ikile. `\r` de tetiklemeli — yalnızca `\n` kontrol ediliyordu ve
 *   içinde CR geçen bir konu satır enjeksiyonuna yol açıyordu.
 * - **Formül enjeksiyonu** (`=`, `+`, `-`, `@` ile başlayan değer): tırnaklamak
 *   İŞE YARAMAZ. Excel ayrıştırırken tırnakları soyar ve hücre değeri yine
 *   `=cmd|'/c calc'!A0` olur, yine formül olarak çalışır. Çare değerin başına
 *   tek tırnak koymaktır — Excel bunu "metin olarak yorumla" işareti sayar.
 *   Ayrıca kontrol baştaki boşluğu da atlamalı: `\t=cmd|...` eski regex'e
 *   (index 0'da sabitli) hiç uymuyordu, yani tespit bile edilmiyordu.
 *
 * Tehdit gerçek ve kimliksiz: POST /tickets ile konusu `=cmd|'/c calc'!A0` olan
 * bir talep açılır, bir yönetici raporu CSV olarak dışa aktarıp açtığında
 * kendi makinesinde DDE tetiklenir.
 */
export function csvEscape(value: string | null | undefined): string {
  if (value == null) return '';
  let str = String(value);

  // Formül nötrleştirmesi ÖNCE — baştaki boşluk/tab atlanarak kontrol edilir.
  if (/^[\s]*[=+\-@]/.test(str)) {
    str = `'${str}`;
  }

  // Çerçeveleme — CR de dahil.
  if (str.includes('"') || str.includes(';') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Ticket kümesini sabit bir `take` tavanıyla DEĞİL, keyset (imleç) ile
 * batch batch gezer. Eski `take: 50000` tavanı sessiz kesme yapıyordu:
 * 50.001. ticket grafikte hiç görünmüyordu. Burada filtrelenen kümenin
 * tamamı taranır; bellek batch boyutuyla sınırlı kalır (satırlar visit
 * ile aggregate'e işlenir, tutulmaz).
 *
 * Sıralama `id` ile eşitlenir — aynı `createdAt`'li kayıtlar arasında
 * imleç konumu deterministik olsun diye.
 */
const TICKET_SCAN_BATCH = 2000;

type ReportScanRow = {
  id: string;
  createdAt: Date;
  status: TicketStatus;
  resolvedAt: Date | null;
  slaResponseMet: boolean | null;
  slaResolveMet: boolean | null;
};

const reportScanSelect = {
  id: true,
  createdAt: true,
  status: true,
  resolvedAt: true,
  slaResponseMet: true,
  slaResolveMet: true,
} satisfies Prisma.TicketSelect;

async function forEachTicketBatch(
  prisma: Prisma.TransactionClient | PrismaClient,
  where: Prisma.TicketWhereInput,
  visit: (rows: ReportScanRow[]) => void,
): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const rows: ReportScanRow[] = await prisma.ticket.findMany({
      where,
      select: reportScanSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: TICKET_SCAN_BATCH,
    });
    if (rows.length === 0) return;
    visit(rows);
    cursor = rows[rows.length - 1].id;
  }
}

export const reportRoutes: FastifyPluginAsyncZod = async (app) => {  // Ticket report with date filtering and aggregation
  app.get('/tickets', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: {
      querystring: reportFilterSchema, tags: ['Reports'], summary: 'Ticket raporunu getir',
      response: {
        200: z.object({
          success: z.literal(true), data: z.array(reportTicketSchema),
          pagination: z.object({ page: z.number().int(), limit: z.number().int(), total: z.number().int(), totalPages: z.number().int() }),
        }),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    const query = request.query;
    const { skip, take } = paginate(query);
    const staffUser = request.staffUser!;

    const scopeCompanyIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);

    const where: Prisma.TicketWhereInput = { ...resolveCompanyFilter(scopeCompanyIds, query.companyId) };
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo + 'T23:59:59Z');
    }
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
        select: {
          id: true, ticketNumber: true, subject: true, status: true, priority: true,
          createdByEmail: true, createdAt: true, resolvedAt: true,
          slaResponseMet: true, slaResolveMet: true,
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
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: { querystring: commonReportFilterSchema, tags: ['Reports'], summary: 'Personel performans raporunu getir', response: { 200: responseOf(z.array(performanceSchema)), ...commonErrorResponses } },
  }, async (request, reply) => {
    const query = request.query;
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
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: { querystring: commonReportFilterSchema, tags: ['Reports'], summary: 'Kategori dağılım raporunu getir', response: { 200: responseOf(z.array(categoryReportSchema)), ...commonErrorResponses } },
  }, async (request, reply) => {
    const query = request.query;
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

  // Memnuniyet (CSAT) — ortalama, dağılım, kırılımlar ve son yorumlar.
  app.get('/satisfaction', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: {
      querystring: commonReportFilterSchema,
      tags: ['Reports'],
      summary: 'Memnuniyet (CSAT) raporunu getir',
      response: { 200: responseOf(satisfactionReportSchema), ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const staffUser = request.staffUser!;
    const scopeCompanyIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    const where: Prisma.TicketWhereInput = { ...buildTicketWhere(request.query, scopeCompanyIds), satisfactionRating: { not: null } };

    const [overall, distribution, byStaff, byCategory, byCompany, surveysSent, comments] = await Promise.all([
      app.prisma.ticket.aggregate({ where, _avg: { satisfactionRating: true }, _count: true }),
      app.prisma.ticket.groupBy({ by: ['satisfactionRating'], where, _count: true }),
      app.prisma.ticket.groupBy({ by: ['assignedToId'], where, _avg: { satisfactionRating: true }, _count: true }),
      app.prisma.ticket.groupBy({ by: ['categoryId'], where, _avg: { satisfactionRating: true }, _count: true }),
      app.prisma.ticket.groupBy({ by: ['companyId'], where, _avg: { satisfactionRating: true }, _count: true }),
      app.prisma.ticket.count({ where: { ...buildTicketWhere(request.query, scopeCompanyIds), surveySentAt: { not: null } } }),
      app.prisma.ticket.findMany({
        where: { ...where, satisfactionComment: { not: null } },
        orderBy: { satisfactionAt: 'desc' },
        take: 10,
        select: { id: true, ticketNumber: true, satisfactionRating: true, satisfactionComment: true, satisfactionAt: true },
      }),
    ]);

    const [staff, categories, companies] = await Promise.all([
      app.prisma.staff.findMany({ where: { id: { in: byStaff.map(s => s.assignedToId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } }),
      app.prisma.category.findMany({ where: { id: { in: byCategory.map(c => c.categoryId) } }, select: { id: true, name: true } }),
      app.prisma.company.findMany({ where: { id: { in: byCompany.map(c => c.companyId) } }, select: { id: true, name: true } }),
    ]);
    const names = new Map([...staff.map(s => [s.id, s.fullName] as const), ...categories.map(c => [c.id, c.name] as const), ...companies.map(c => [c.id, c.name] as const)]);
    const round = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
    const breakdown = <K extends string>(rows: Array<Record<K, string | null> & { _avg: { satisfactionRating: number | null }; _count: number }>, key: K) =>
      rows
        .map(r => ({ id: r[key], name: r[key] ? names.get(r[key]) ?? '?' : null, count: r._count, average: round(r._avg.satisfactionRating) }))
        .sort((a, b) => b.count - a.count);

    reply.send({
      success: true,
      data: {
        count: overall._count,
        average: round(overall._avg.satisfactionRating),
        surveysSent,
        responseRate: surveysSent > 0 ? Math.round((overall._count / surveysSent) * 100) : null,
        distribution: [1, 2, 3, 4, 5].map(rating => ({ rating, count: distribution.find(d => d.satisfactionRating === rating)?._count ?? 0 })),
        byStaff: breakdown(byStaff, 'assignedToId'),
        byCategory: breakdown(byCategory, 'categoryId'),
        byCompany: breakdown(byCompany, 'companyId'),
        recentComments: comments.map(c => ({
          ticketId: c.id, ticketNumber: c.ticketNumber, rating: c.satisfactionRating!, comment: c.satisfactionComment!, at: c.satisfactionAt,
        })),
      },
    });
  });

  // CSV export
  app.get('/export/csv', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: { querystring: commonReportFilterSchema, tags: ['Reports'], summary: 'Ticket raporunu CSV dışa aktar' },
  }, async (request, reply) => {
    const query = request.query;
    const staffUser = request.staffUser!;

    const scopeCompanyIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    const where = buildTicketWhere(query, scopeCompanyIds);

    // Export akışlı: sabit `take: 10000` tavanı satır sessizce kesiyordu.
    // Batch batch üretilip PassThrough'a yazılır — bellek sabit, küme tam.
    const BOM = '\ufeff';
    const headers = ['Talep No', 'Konu', 'Şirket', 'Lokasyon', 'Kategori', 'Durum', 'Öncelik', 'Atanan', 'Oluşturan Email', 'Oluşturma Tarihi', 'Çözüm Tarihi'];

    const stream = new PassThrough();
    // destroy(err) sonrası yazım denemeleri süreci düşürmesin — hata zaten
    // loglanıyor ve yanıt başlıkları gönderilmiş durumda.
    stream.on('error', () => {});
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="ticket-rapor-${new Date().toISOString().split('T')[0]}.csv"`)
      .send(stream);

    // İstemci indirmeyi bırakırsa imleç döngüsünü durdur; aksi halde pump
    // tamamlanana kadar boşuna DB sorgusu döner.
    let aborted = false;
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) {
        aborted = true;
        stream.destroy();
      }
    });
    const writeChunk = async (chunk: string) => {
      if (!stream.write(chunk)) await once(stream, 'drain');
    };

    const pump = (async () => {
      await writeChunk(BOM + headers.join(';') + '\n');
      let cursor: string | undefined;
      for (;;) {
        if (aborted) return;
        const tickets = await app.prisma.ticket.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          take: TICKET_SCAN_BATCH,
          include: {
            company: { select: { name: true } },
            location: { select: { name: true } },
            category: { select: { name: true } },
            assignedTo: { select: { fullName: true } },
          },
        });
        if (tickets.length === 0) break;
        let chunk = '';
        for (const t of tickets) {
          chunk += [
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
          ].join(';') + '\n';
        }
        await writeChunk(chunk);
        cursor = tickets[tickets.length - 1].id;
      }
      stream.end();
    })();

    try {
      await pump;
    } catch (err) {
      // Yanıt zaten akış halinde; kod 500 gönderilemez — kesilen indirme
      // (istemci tarafında bozuk dosya) loglanır.
      app.log.error({ err }, 'CSV export akışı yarıda kesildi');
      stream.destroy();
    }
  });

  // Zaman serisi overview: günlük / haftalık / aylık bucket'larda created/resolved/inProgress/overdue
  app.get('/overview', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: {
      querystring: overviewFilterSchema, tags: ['Reports'], summary: 'Rapor zaman serisini getir',
      response: {
        200: responseOf(z.array(overviewBucketSchema)).extend({ period: z.enum(['day', 'week', 'month']) }),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    const query = request.query;
    const period = query.period === 'weekly' ? 'week' : query.period === 'monthly' ? 'month' : 'day';
    const staffUser = request.staffUser!;

    const scopeCompanyIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    const where = buildTicketWhere(query, scopeCompanyIds);

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

    await forEachTicketBatch(app.prisma, where, (rows) => {
      for (const t of rows) {
        const created = ensure(bucketKey(new Date(t.createdAt)));
        created.created += 1;
        if (t.status === 'in_progress') created.inProgress += 1;
        if (t.slaResolveMet === false) created.overdue += 1;
        if (t.resolvedAt) {
          const r = ensure(bucketKey(new Date(t.resolvedAt)));
          r.resolved += 1;
        }
      }
    });

    const data = Array.from(buckets.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));
    reply.send({ success: true, data, period });
  });

  // SLA trend serisi
  app.get('/sla-trends', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: {
      querystring: slaTrendFilterSchema, tags: ['Reports'], summary: 'SLA trend raporunu getir',
      response: {
        200: responseOf(z.array(slaTrendSchema)).extend({ period: z.enum(['week', 'month']) }),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    const query = request.query;
    const period = query.period === 'monthly' ? 'month' : 'week';
    const staffUser = request.staffUser!;

    const scopeCompanyIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    const where = buildTicketWhere(query, scopeCompanyIds);

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

    await forEachTicketBatch(app.prisma, where, (rows) => {
      for (const t of rows) {
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
