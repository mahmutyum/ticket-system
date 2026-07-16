import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { generateTicketNumber } from '../../utils/ticket-number.js';
import { paginationSchema, paginate, paginatedResponse } from '../../utils/pagination.js';
import { requiredText, optionalText, phoneSchema, emailSchema, LIMITS, ATTACHMENT_LIMITS } from '../../utils/validation.js';
import { Prisma, TicketStatus, Priority } from '@prisma/client';
import { queueEmail, queueSms } from '../../jobs/queue.js';
import { saveFile, isAllowedMimeType } from '../../services/storage.service.js';
import { config } from '../../config/index.js';
import { broadcastToStaff, broadcastToTicket } from '../../services/sse.service.js';
import { getStaffCompanyScope, resolveCompanyFilter, isCompanyInScope } from '../../utils/staff-scope.js';
import { calculateSlaDueDates, isSlaMet } from '../../utils/sla.js';
import { commonErrorResponses } from '../../utils/api-schema.js';

/**
 * Ticket kapandıktan sonra public takip linkinin ne kadar geçerli kalacağı.
 *
 * Talep eden sonucu görebilmeli, ama link sonsuza dek çalışmamalı — access_log'a
 * ve e-postalara düştüğü için tek bir sızıntı kalıcı erişim demek olurdu.
 * Süresi dolan link için /public/track ile (ticket no + e-posta) yeniden erişim
 * alınabilir.
 */
const PUBLIC_ACCESS_RETENTION_DAYS = 90;

/**
 * Ticket oluşturma — KİMLİK DOĞRULAMASI YOK, yalnızca rate limit var.
 *
 * Bu yüzden buradaki her alan hem kırpılır hem sınırlanır:
 * - `min(1)` yeterli değildi: `"   "` ve `"\n"` geçiyordu, yani "zorunlu" alanlar
 *   boşlukla doldurulabiliyordu. `trim()` önce gelir.
 * - Üst sınır yoktu: `description` ve özel alan değerleri istek başına ~1 MB'a
 *   (Fastify gövde limiti) kadar yazılabiliyor, DB tarafında `TEXT` hiçbir şey
 *   zorlamıyordu.
 */
const ticketCreateSchema = z.object({
  companyId: z.string().cuid(),
  locationId: z.string().cuid(),
  categoryId: z.string().cuid(),
  email: emailSchema,
  fullName: requiredText({ ...LIMITS.fullName, label: 'Ad soyad' }),
  phone: phoneSchema,
  department: optionalText({ ...LIMITS.shortLabel, label: 'Departman' }),
  subject: requiredText({ ...LIMITS.ticketSubject, label: 'Konu' }),
  description: requiredText({ ...LIMITS.ticketDescription, label: 'Açıklama' }),
  priority: z.nativeEnum(Priority).default(Priority.medium),
  customFields: z
    .array(
      z.object({
        fieldId: z.string().cuid(),
        value: z.string().trim().max(LIMITS.customFieldValue.max, 'Alan değeri çok uzun'),
      }),
    )
    // Form alanı sayısı şirket başına tanımlı; makul bir üst sınır koymak
    // binlerce sahte alanla istek şişirmeyi engeller.
    .max(50, 'Çok fazla özel alan')
    .optional(),
});

const ticketUpdateSchema = z.object({
  status: z.nativeEnum(TicketStatus).optional(),
  priority: z.nativeEnum(Priority).optional(),
  assignedToId: z.string().cuid().nullable().optional(),
});

const ticketFilterSchema = paginationSchema.extend({
  status: z.nativeEnum(TicketStatus).optional(),
  priority: z.nativeEnum(Priority).optional(),
  companyId: z.string().optional(),
  categoryId: z.string().optional(),
  assignedToId: z.string().optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

const ticketIdParamsSchema = z.object({ id: z.string().min(1).max(128) });
const ticketBulkUpdateSchema = z.object({
  ticketIds: z.array(z.string().cuid()).min(1).max(100),
  status: z.nativeEnum(TicketStatus).optional(),
  assignedToId: z.string().cuid().nullable().optional(),
  priority: z.nativeEnum(Priority).optional(),
});
const ticketSearchSchema = z.object({ q: z.string().trim().max(200).optional() });

const ticketCreateResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    ticketNumber: z.string(),
    accessToken: z.string(),
    trackingUrl: z.string().url(),
    status: z.nativeEnum(TicketStatus),
    subject: z.string(),
  }),
});

const ticketBulkUpdateResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    updated: z.number().int().nonnegative(),
    requested: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
});

const ticketSearchResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(z.object({
    id: z.string(),
    ticketNumber: z.string(),
    subject: z.string(),
    status: z.nativeEnum(TicketStatus),
    priority: z.nativeEnum(Priority),
    createdAt: z.date(),
  })),
});

const staffTicketBaseSchema = z.object({
  id: z.string(), ticketNumber: z.string(), companyId: z.string(), locationId: z.string(),
  categoryId: z.string(), createdByEmail: z.string().email(), createdByUserId: z.string().nullable(),
  assignedToId: z.string().nullable(), subject: z.string(), description: z.string(),
  priority: z.nativeEnum(Priority), status: z.nativeEnum(TicketStatus),
  slaResponseDue: z.date().nullable(), slaResolveDue: z.date().nullable(),
  slaResponseMet: z.boolean().nullable(), slaResolveMet: z.boolean().nullable(),
  firstRespondedAt: z.date().nullable(), resolvedAt: z.date().nullable(), closedAt: z.date().nullable(),
  createdAt: z.date(), updatedAt: z.date(),
});
const ticketListItemSchema = staffTicketBaseSchema.pick({
  id: true, ticketNumber: true, companyId: true, assignedToId: true, createdByEmail: true,
  subject: true, priority: true, status: true, slaResponseDue: true, slaResolveDue: true,
  slaResponseMet: true, slaResolveMet: true, firstRespondedAt: true, resolvedAt: true,
  createdAt: true, updatedAt: true,
}).extend({
  company: z.object({ name: z.string() }), location: z.object({ name: z.string() }),
  category: z.object({ name: z.string() }),
  assignedTo: z.object({ id: z.string(), fullName: z.string() }).nullable(),
  createdBy: z.object({ fullName: z.string(), phone: z.string().nullable() }).nullable(),
});
const staffTicketDetailSchema = staffTicketBaseSchema.extend({
  company: z.unknown(), location: z.unknown(), category: z.unknown(),
  assignedTo: z.unknown(), createdBy: z.unknown(), customValues: z.unknown(),
  notes: z.unknown(), history: z.unknown(), attachments: z.unknown(), onsiteSupport: z.unknown(),
});
const staffTicketUpdateResponseSchema = staffTicketBaseSchema.extend({
  company: z.object({ name: z.string() }),
  assignedTo: z.object({ id: z.string(), fullName: z.string() }).nullable(),
});
const staffAttachmentSchema = z.object({
  id: z.string(), ticketId: z.string(), fileName: z.string(), fileSize: z.number().int(),
  mimeType: z.string(), uploadedBy: z.string(), createdAt: z.date(),
});

export const ticketRoutes: FastifyPluginAsyncZod = async (app) => {
  // PUBLIC: Create ticket
  app.post('/', {
    schema: {
      tags: ['Tickets'],
      summary: 'Yeni destek talebi oluşturur',
      body: ticketCreateSchema,
      response: { 201: ticketCreateResponseSchema, ...commonErrorResponses },
    },
    config: {
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
  }, async (request, reply) => {
    const body = request.body;

    // Validate company access
    const company = await app.prisma.company.findUnique({
      where: { id: body.companyId },
      select: { allowedDomains: true, portalDomains: true, notificationEmail: true },
    });

    if (!company) {
      return reply.status(404).send({ success: false, error: 'Şirket bulunamadı' });
    }

    // Portal domain lock: if request comes from a portal domain mapped to a DIFFERENT company, block it
    const origin = request.headers['origin'] || request.headers['referer'] || '';
    let originHostname = '';
    try { originHostname = new URL(origin).hostname.toLowerCase(); } catch { /* ignore */ }

    if (originHostname) {
      const portalLockedCompanies = await app.prisma.company.findMany({
        where: {
          isActive: true,
          id: { not: body.companyId },
        },
        select: { id: true, portalDomains: true },
      });

      const blocked = portalLockedCompanies.some(c => {
        const portals = c.portalDomains as string[];
        return portals?.some(d => d.toLowerCase() === originHostname);
      });

      if (blocked) {
        return reply.status(403).send({
          success: false,
          error: 'Bu portal üzerinden yalnızca ilgili şirket için talep oluşturabilirsiniz.',
        });
      }
    }

    // Email domain restriction
    const allowedDomains = company.allowedDomains as string[];
    if (allowedDomains && allowedDomains.length > 0) {
      const emailDomain = body.email.split('@')[1]?.toLowerCase();
      const domainAllowed = allowedDomains.some(d => d.toLowerCase() === emailDomain);
      if (!domainAllowed) {
        return reply.status(400).send({
          success: false,
          error: 'Bu email adresi ile destek talebi oluşturamazsınız.',
        });
      }
    }

    // Find or create user
    let user = await app.prisma.user.findUnique({
      where: { email: body.email },
    });

    if (user) {
      // Update user info
      user = await app.prisma.user.update({
        where: { email: body.email },
        data: {
          fullName: body.fullName,
          phone: body.phone || user.phone,
          companyId: body.companyId,
          locationId: body.locationId,
          department: body.department || user.department,
        },
      });
    } else {
      user = await app.prisma.user.create({
        data: {
          email: body.email,
          fullName: body.fullName,
          phone: body.phone,
          companyId: body.companyId,
          locationId: body.locationId,
          department: body.department,
        },
      });
    }

    const ticketNumber = await generateTicketNumber();
    const accessToken = nanoid(32);

    // Calculate SLA if category has SLA settings
    const category = await app.prisma.category.findUnique({
      where: { id: body.categoryId },
    });

    const { slaResponseDue, slaResolveDue } = calculateSlaDueDates(category);

    // Create ticket with custom fields
    const ticket = await app.prisma.ticket.create({
      data: {
        ticketNumber,
        companyId: body.companyId,
        locationId: body.locationId,
        categoryId: body.categoryId,
        createdByEmail: body.email,
        createdByUserId: user.id,
        subject: body.subject,
        description: body.description,
        priority: body.priority,
        accessToken,
        slaResponseDue,
        slaResolveDue,
        // Auto-assign if category has it set
        assignedToId: category?.autoAssignTo || undefined,
        customValues: body.customFields
          ? {
              create: body.customFields.map(cf => ({
                customFieldId: cf.fieldId,
                value: cf.value,
              })),
            }
          : undefined,
        history: {
          create: {
            action: 'ticket_created',
            newValue: 'open',
            createdByEmail: body.email,
          },
        },
      },
      include: {
        company: { select: { name: true } },
        location: { select: { name: true } },
        category: { select: { name: true } },
      },
    });

    // Queue email notification
    const trackingUrl = `${config.CANONICAL_URL}/ticket/${accessToken}`;
    await queueEmail({
      to: body.email,
      templateSlug: 'ticket_created',
      variables: {
        ticketNumber,
        userName: body.fullName,
        subject: body.subject,
        priority: body.priority,
        trackingUrl,
      },
      ticketId: ticket.id,
      companyId: body.companyId,
    });

    // Queue SMS if phone provided
    if (body.phone) {
      await queueSms({
        to: body.phone,
        templateSlug: 'ticket_created',
        variables: { ticketNumber, trackingUrl },
        ticketId: ticket.id,
      });
    }

    // Notify company's IT group email
    if (company.notificationEmail) {
      const staffUrl = `${config.CANONICAL_URL}/staff/tickets/${ticket.id}`;
      await queueEmail({
        to: company.notificationEmail,
        templateSlug: 'ticket_created_internal',
        variables: {
          ticketNumber,
          companyName: ticket.company.name,
          userName: body.fullName,
          userEmail: body.email,
          subject: body.subject,
          priority: body.priority,
          categoryName: ticket.category?.name || '-',
          staffUrl,
        },
        ticketId: ticket.id,
        companyId: body.companyId,
      });
    }

    // Broadcast to staff
    broadcastToStaff('ticket_created', {
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      status: ticket.status,
      priority: body.priority,
      company: ticket.company.name,
    }, ticket.companyId);

    reply.status(201).send({
      success: true,
      data: {
        ticketNumber: ticket.ticketNumber,
        accessToken: ticket.accessToken,
        trackingUrl: `${config.CANONICAL_URL}/ticket/${ticket.accessToken}`,
        status: ticket.status,
        subject: ticket.subject,
      },
    });
  });

  // STAFF: List tickets with filters
  app.get('/', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Tickets'],
      summary: 'Destek taleplerini filtreleyerek listeler',
      querystring: ticketFilterSchema,
      response: {
        200: z.object({
          success: z.literal(true), data: z.array(ticketListItemSchema),
          pagination: z.object({
            page: z.number().int(), limit: z.number().int(), total: z.number().int(), totalPages: z.number().int(),
          }),
        }),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    const query = request.query;
    const { skip, take } = paginate(query);
    const staffUser = request.staffUser!;

    // Company scope restriction — istemciden gelen companyId filtresi kapsamla
    // kesiştirilir; doğrudan atanırsa kapsamı ezer ve yetki aşımına yol açar.
    const scopeCompanyIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);

    const where: Prisma.TicketWhereInput = { ...resolveCompanyFilter(scopeCompanyIds, query.companyId) };
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.assignedToId) where.assignedToId = query.assignedToId;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }
    if (query.search) {
      where.OR = [
        { subject: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        { ticketNumber: { contains: query.search, mode: 'insensitive' } },
        { createdByEmail: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [tickets, total] = await Promise.all([
      app.prisma.ticket.findMany({
        where,
        skip,
        take,
        orderBy: { [query.sortBy]: query.sortOrder },
        // AÇIK `select` — `include` kullanılırsa Ticket'ın TÜM skalerleri döner,
        // `accessToken` dahil. O token public takip linkinin bearer sırrıdır,
        // süresizdir ve iptal edilemez: listede dönerse listeleyebilen herkes her
        // ticket için kalıcı bir public erişim anahtarı almış olur ve token
        // tarayıcı cache'ine, proxy loglarına düşer.
        select: {
          id: true,
          ticketNumber: true,
          subject: true,
          status: true,
          priority: true,
          createdByEmail: true,
          createdAt: true,
          updatedAt: true,
          slaResponseDue: true,
          slaResolveDue: true,
          slaResponseMet: true,
          slaResolveMet: true,
          firstRespondedAt: true,
          resolvedAt: true,
          companyId: true,
          assignedToId: true,
          company: { select: { name: true } },
          location: { select: { name: true } },
          category: { select: { name: true } },
          assignedTo: { select: { id: true, fullName: true } },
          createdBy: { select: { fullName: true, phone: true } },
        },
      }),
      app.prisma.ticket.count({ where }),
    ]);

    reply.send(paginatedResponse(tickets, total, query));
  });

  // STAFF: Get ticket detail
  app.get('/:id', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Tickets'],
      summary: 'Destek talebi ayrıntısını getirir',
      params: ticketIdParamsSchema,
      response: {
        200: z.object({ success: z.literal(true), data: staffTicketDetailSchema }),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const ticket = await app.prisma.ticket.findUnique({
      where: { id },
      include: {
        company: true,
        location: true,
        category: true,
        assignedTo: { select: { id: true, fullName: true, email: true, role: true } },
        createdBy: true,
        customValues: { include: { customField: true } },
        notes: {
          include: { createdBy: { select: { fullName: true, role: true } } },
          orderBy: { createdAt: 'asc' },
        },
        history: {
          include: { createdBy: { select: { fullName: true } } },
          orderBy: { createdAt: 'asc' },
        },
        attachments: true,
        onsiteSupport: { include: { location: true } },
      },
    });

    if (!ticket) {
      return reply.status(404).send({ success: false, error: 'Ticket bulunamadı' });
    }

    // Company scope check
    const scopeIds = await getStaffCompanyScope(app.prisma, request.staffUser!.id, request.staffUser!.role);
    if (scopeIds && !scopeIds.includes(ticket.companyId)) {
      return reply.status(403).send({ success: false, error: 'Bu talebe erişim yetkiniz yok' });
    }

    const {
      accessToken: _accessToken,
      accessTokenExpiresAt: _accessTokenExpiresAt,
      createdBy,
      attachments,
      ...safeTicket
    } = ticket;
    reply.send({
      success: true,
      data: {
        ...safeTicket,
        createdBy: createdBy
          ? { fullName: createdBy.fullName, phone: createdBy.phone }
          : null,
        attachments: attachments.map(({ filePath: _filePath, ...attachment }) => attachment),
      },
    });
  });

  // STAFF: Update ticket (status, priority, assignment)
  app.put('/:id', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Tickets'],
      summary: 'Destek talebini günceller',
      params: ticketIdParamsSchema,
      body: ticketUpdateSchema,
      response: {
        200: z.object({ success: z.literal(true), data: staffTicketUpdateResponseSchema }),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body;
    const staffUser = request.staffUser!;

    const currentTicket = await app.prisma.ticket.findUnique({ where: { id } });
    if (!currentTicket) {
      return reply.status(404).send({ success: false, error: 'Ticket bulunamadı' });
    }

    // Şirket kapsamı — GET /:id bunu yapıyordu, PUT yapmıyordu. Yani kapsam dışı
    // bir ticket okunamıyor ama id'si bilindiğinde DEĞİŞTİRİLEBİLİYORDU: durum,
    // öncelik ve atama. Yazma yetkisi okuma yetkisinden geniş olamaz.
    const scopeIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    if (!isCompanyInScope(scopeIds, currentTicket.companyId)) {
      return reply.status(403).send({ success: false, error: 'Bu talebe erişim yetkiniz yok' });
    }

    const historyEntries: Prisma.TicketHistoryUncheckedCreateWithoutTicketInput[] = [];
    const updateData: Prisma.TicketUncheckedUpdateInput = {};

    if (body.status && body.status !== currentTicket.status) {
      updateData.status = body.status;
      historyEntries.push({
        action: 'status_changed',
        field: 'status',
        oldValue: currentTicket.status,
        newValue: body.status,
        createdById: staffUser.id,
      });

      // Track first response and resolution
      if (!currentTicket.firstRespondedAt && body.status === TicketStatus.in_progress) {
        updateData.firstRespondedAt = new Date();
        updateData.slaResponseMet = isSlaMet(currentTicket.slaResponseDue, new Date());
      }
      if (body.status === TicketStatus.resolved) {
        updateData.resolvedAt = new Date();
        updateData.slaResolveMet = isSlaMet(currentTicket.slaResolveDue, new Date());
      }
      if (body.status === TicketStatus.closed) {
        updateData.closedAt = new Date();
      }

      // Public takip linkine SON VER / geri aç.
      //
      // Link nginx access_log'una, e-postalara ve tarayıcı geçmişine düşer;
      // süresiz kalırsa tek bir sızıntı o ticket'a kalıcı erişim demektir.
      // Talep eden kapanıştan sonra da bir süre sonucu görebilmeli — bu yüzden
      // iptal değil, saklama süreli sona erdirme.
      if (body.status === TicketStatus.resolved || body.status === TicketStatus.closed) {
        updateData.accessTokenExpiresAt = new Date(
          Date.now() + PUBLIC_ACCESS_RETENTION_DAYS * 24 * 60 * 60 * 1000,
        );
      } else {
        // Yeniden açıldı → link tekrar süresiz.
        updateData.accessTokenExpiresAt = null;
      }
    }

    if (body.priority && body.priority !== currentTicket.priority) {
      updateData.priority = body.priority;
      historyEntries.push({
        action: 'priority_changed',
        field: 'priority',
        oldValue: currentTicket.priority,
        newValue: body.priority,
        createdById: staffUser.id,
      });
    }

    if (body.assignedToId !== undefined && body.assignedToId !== currentTicket.assignedToId) {
      updateData.assignedToId = body.assignedToId;
      historyEntries.push({
        action: 'assigned',
        field: 'assignedToId',
        oldValue: currentTicket.assignedToId,
        newValue: body.assignedToId,
        createdById: staffUser.id,
      });
    }

    const ticket = await app.prisma.ticket.update({
      where: { id },
      data: {
        ...updateData,
        history: historyEntries.length > 0
          ? { create: historyEntries }
          : undefined,
      },
      include: {
        company: { select: { name: true } },
        assignedTo: { select: { id: true, fullName: true } },
      },
    });

    // SSE broadcast
    broadcastToStaff('ticket_updated', {
      id: ticket.id,
      ticketNumber: currentTicket.ticketNumber,
      status: ticket.status,
      priority: ticket.priority,
      assignedTo: ticket.assignedTo?.fullName,
    }, ticket.companyId);
    broadcastToTicket(currentTicket.accessToken, 'ticket_updated', {
      status: ticket.status,
      priority: ticket.priority,
    });

    const {
      accessToken: _accessToken,
      accessTokenExpiresAt: _accessTokenExpiresAt,
      ...safeTicket
    } = ticket;
    reply.send({ success: true, data: safeTicket });
  });

  // STAFF: Bulk update tickets
  app.post('/bulk', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: {
      tags: ['Tickets'],
      summary: 'Destek taleplerini toplu günceller',
      body: ticketBulkUpdateSchema,
      response: { 200: ticketBulkUpdateResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const body = request.body;

    const staffUser = request.staffUser!;

    const updateData: Prisma.TicketUncheckedUpdateManyInput = {};
    if (body.status) updateData.status = body.status;
    if (body.assignedToId !== undefined) updateData.assignedToId = body.assignedToId;
    if (body.priority) updateData.priority = body.priority;

    // Company scope restriction
    const scopeCompanyIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    const scopeWhere = scopeCompanyIds ? { companyId: { in: scopeCompanyIds } } : {};

    const result = await app.prisma.ticket.updateMany({
      where: { id: { in: body.ticketIds }, ...scopeWhere },
      data: updateData,
    });

    reply.send({
      success: true,
      data: {
        updated: result.count,
        requested: body.ticketIds.length,
        skipped: body.ticketIds.length - result.count,
      },
    });
  });

  // STAFF: Upload attachment
  app.post('/:id/attachments', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Tickets'],
      summary: 'Destek talebine dosya ekler',
      params: ticketIdParamsSchema,
      response: {
        201: z.object({ success: z.literal(true), data: staffAttachmentSchema }),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const ticket = await app.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) {
      return reply.status(404).send({ success: false, error: 'Ticket bulunamadı' });
    }

    // Şirket kapsamı — bu uç da kapsamsızdı: kapsam dışı bir ticket'a dosya
    // eklenebiliyordu ve ek, o ticket'ın public takip linkinden servis ediliyor.
    const scopeIds = await getStaffCompanyScope(app.prisma, request.staffUser!.id, request.staffUser!.role);
    if (!isCompanyInScope(scopeIds, ticket.companyId)) {
      return reply.status(403).send({ success: false, error: 'Bu talebe erişim yetkiniz yok' });
    }

    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ success: false, error: 'Dosya gerekli' });
    }

    if (!isAllowedMimeType(file.mimetype)) {
      return reply.status(400).send({ success: false, error: 'Desteklenmeyen dosya türü' });
    }

    // Ticket başına kota. Dosya başına 25 MB sınırı vardı ama toplam yoktu:
    // aynı ticket'a sınırsız ek yüklenip disk şişirilebiliyordu.
    const existing = await app.prisma.attachment.aggregate({
      where: { ticketId: id },
      _count: true,
      _sum: { fileSize: true },
    });
    if (existing._count >= ATTACHMENT_LIMITS.maxCount) {
      return reply.status(400).send({
        success: false,
        error: `Bir talebe en fazla ${ATTACHMENT_LIMITS.maxCount} dosya eklenebilir`,
      });
    }

    const buffer = await file.toBuffer();

    const totalAfter = (existing._sum.fileSize ?? 0) + buffer.length;
    if (totalAfter > ATTACHMENT_LIMITS.maxTotalBytes) {
      const mb = Math.floor(ATTACHMENT_LIMITS.maxTotalBytes / (1024 * 1024));
      return reply.status(400).send({
        success: false,
        error: `Talep başına toplam ek boyutu ${mb} MB'ı aşamaz`,
      });
    }

    const saved = await saveFile(buffer, file.filename, id, file.mimetype);

    const attachment = await app.prisma.attachment.create({
      data: {
        ticketId: id,
        fileName: saved.fileName,
        filePath: saved.filePath,
        fileSize: saved.fileSize,
        mimeType: file.mimetype,
        uploadedBy: request.staffUser!.email,
      },
    });

    await app.prisma.ticketHistory.create({
      data: {
        ticketId: id,
        action: 'attachment_added',
        newValue: saved.fileName,
        createdById: request.staffUser!.id,
      },
    });

    const { filePath: _filePath, ...safeAttachment } = attachment;
    reply.status(201).send({ success: true, data: safeAttachment });
  });

  // STAFF: Search tickets
  app.get('/search', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Tickets'],
      summary: 'Destek taleplerinde arama yapar',
      querystring: ticketSearchSchema,
      response: { 200: ticketSearchResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const { q } = request.query;
    if (!q || q.length < 2) {
      return reply.send({ success: true, data: [] });
    }

    const staffUser = request.staffUser!;
    const scopeCompanyIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    const scopeWhere = scopeCompanyIds ? { companyId: { in: scopeCompanyIds } } : {};

    const tickets = await app.prisma.ticket.findMany({
      where: {
        ...scopeWhere,
        OR: [
          { subject: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { ticketNumber: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 20,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        ticketNumber: true,
        subject: true,
        status: true,
        priority: true,
        createdAt: true,
      },
    });

    reply.send({ success: true, data: tickets });
  });
};
