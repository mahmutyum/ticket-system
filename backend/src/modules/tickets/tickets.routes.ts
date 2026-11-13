import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { paginationSchema, paginate, paginatedResponse } from '../../utils/pagination.js';
import { requiredText, optionalText, phoneSchema, emailSchema, LIMITS, ATTACHMENT_LIMITS } from '../../utils/validation.js';
import { Prisma, TicketStatus, Priority } from '@prisma/client';
import { queueEmail, queueSms } from '../../jobs/queue.js';
import { saveFile, isAllowedMimeType, isBufferConsistentWithMime } from '../../services/storage.service.js';
import { broadcastToStaff, broadcastToTicket } from '../../services/sse.service.js';
import { getStaffCompanyScope, resolveCompanyFilter, isCompanyInScope } from '../../utils/staff-scope.js';
import { planStatusTransition } from '../../utils/ticket-lifecycle.js';
import { emitTicketChanges } from '../../services/webhooks/emit.js';
import { maybeSendSurvey } from '../../services/satisfaction.js';
import { createRequesterTicket, isEmailDomainAllowed, trackingUrlFor } from '../../services/ticket-intake.js';
import { calendarFor, createSlaContextCache, loadCompanySlaContext } from '../../services/sla-context.js';
import { commonErrorResponses } from '../../utils/api-schema.js';
import { t } from '../../i18n/index.js';

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
  // Bildirim dili — public portalın diline göre yakalanır. Talep sahibinin
  // e-posta/SMS bildirimleri bu dilde gönderilir.
  locale: z.enum(['tr', 'en']).default('tr'),
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
  /** Talep hakkında bilgilendirilecek ek kişiler (CC). Şirketin izinli domain kuralına tabidir. */
  ccEmails: z.array(emailSchema).max(10, 'En fazla 10 CC').optional(),
});

const ticketUpdateSchema = z.object({
  status: z.nativeEnum(TicketStatus).optional(),
  priority: z.nativeEnum(Priority).optional(),
  assignedToId: z.string().cuid().nullable().optional(),
  /** Durum değişikliğini alt ticket'lara da uygula (ör. yaygın arıza çözüldü). */
  applyToChildren: z.boolean().optional(),
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
const ticketSearchSchema = z.object({
  q: z.string().trim().max(200).optional(),
  /** İlişki seçicileri (birleştir / üst talep) yalnızca aynı şirketin ticket'larını ister. */
  companyId: z.string().max(128).optional(),
});

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
  slaPausedAt: z.date().nullable(), slaPausedMinutes: z.number().int(), source: z.string(),
  satisfactionRating: z.number().int().nullable(), satisfactionComment: z.string().nullable(), satisfactionAt: z.date().nullable(),
  firstRespondedAt: z.date().nullable(), resolvedAt: z.date().nullable(), closedAt: z.date().nullable(),
  createdAt: z.date(), updatedAt: z.date(),
});
const ticketListItemSchema = staffTicketBaseSchema.pick({
  id: true, ticketNumber: true, companyId: true, assignedToId: true, createdByEmail: true,
  subject: true, priority: true, status: true, slaResponseDue: true, slaResolveDue: true,
  slaResponseMet: true, slaResolveMet: true, firstRespondedAt: true, resolvedAt: true,
  slaPausedAt: true, createdAt: true, updatedAt: true,
}).extend({
  company: z.object({ name: z.string() }), location: z.object({ name: z.string() }),
  category: z.object({ name: z.string() }),
  assignedTo: z.object({ id: z.string(), fullName: z.string() }).nullable(),
  createdBy: z.object({ fullName: z.string(), phone: z.string().nullable() }).nullable(),
});
const relatedTicketSelect = { id: true, ticketNumber: true, subject: true, status: true } as const;
const relatedTicketSchema = z.object({ id: z.string(), ticketNumber: z.string(), subject: z.string(), status: z.nativeEnum(TicketStatus) });
const staffAttachmentSchema = z.object({
  id: z.string(), ticketId: z.string(), fileName: z.string(), fileSize: z.number().int(),
  mimeType: z.string(), uploadedBy: z.string(), createdAt: z.date(),
});

// GET /:id include'larının tam yanıtları. Serializer şemada tanımlı olmayan
// alanları YANITTAN ATAR — buradaki her nesne prisma/schema.prisma'daki
// modelin skaler alanlarıyla birebir tutulmalıdır (eklenmiş/eksik alan
// frontend'i sessizce kırar). JSON kolonları (settings, slaSettings,
// allowedDomains, options) serbest biçimli config bloklarıdır: z.unknown().
const staffCompanySchema = z.object({
  id: z.string(), name: z.string(), groupType: z.string(), logo: z.string().nullable(),
  primaryColor: z.string().nullable(), allowedDomains: z.unknown(), portalDomains: z.unknown(),
  notificationEmail: z.string().nullable(), isActive: z.boolean(), settings: z.unknown(),
  slaSettings: z.unknown(), createdAt: z.date(), updatedAt: z.date(),
});
const staffLocationSchema = z.object({
  id: z.string(), companyId: z.string(), name: z.string(), address: z.string().nullable(),
  phone: z.string().nullable(), floor: z.string().nullable(), itRoom: z.string().nullable(),
  isActive: z.boolean(), createdAt: z.date(),
});
const staffCategorySchema = z.object({
  id: z.string(), companyId: z.string().nullable(), name: z.string(), description: z.string().nullable(),
  parentId: z.string().nullable(), sortOrder: z.number().int(), isActive: z.boolean(),
  slaResponseMinutes: z.number().int().nullable(), slaResolutionMinutes: z.number().int().nullable(),
  autoAssignTo: z.string().nullable(), createdAt: z.date(),
});
const staffCustomFieldSchema = z.object({
  id: z.string(), companyId: z.string().nullable(), fieldName: z.string(), fieldLabel: z.string(),
  fieldType: z.string(), options: z.unknown(), required: z.boolean(), sortOrder: z.number().int(),
  isActive: z.boolean(), placeholder: z.string().nullable(), createdAt: z.date(),
});
const staffOnsiteSupportSchema = z.object({
  id: z.string(), ticketId: z.string(), locationId: z.string(), type: z.string(),
  scheduledAt: z.date(), scheduledEnd: z.date().nullable(), roomInfo: z.string().nullable(),
  floorInfo: z.string().nullable(), notes: z.string().nullable(), status: z.string(),
  completedAt: z.date().nullable(), createdAt: z.date(),
  location: staffLocationSchema,
});
const staffTicketDetailSchema = staffTicketBaseSchema.extend({
  company: staffCompanySchema,
  location: staffLocationSchema,
  category: staffCategorySchema,
  assignedTo: z.object({ id: z.string(), fullName: z.string(), email: z.string(), role: z.string() }).nullable(),
  createdBy: z.object({ fullName: z.string(), phone: z.string().nullable() }).nullable(),
  customValues: z.array(z.object({
    id: z.string(), ticketId: z.string(), customFieldId: z.string(), value: z.string(),
    customField: staffCustomFieldSchema,
  })),
  notes: z.array(z.object({
    id: z.string(), ticketId: z.string(), content: z.string(), isInternal: z.boolean(),
    createdById: z.string(), createdAt: z.date(),
    createdBy: z.object({ fullName: z.string(), role: z.string() }),
  })),
  history: z.array(z.object({
    id: z.string(), ticketId: z.string(), action: z.string(), field: z.string().nullable(),
    oldValue: z.string().nullable(), newValue: z.string().nullable(), createdById: z.string().nullable(),
    createdByEmail: z.string().nullable(), createdAt: z.date(),
    createdBy: z.object({ fullName: z.string() }).nullable(),
  })),
  attachments: z.array(staffAttachmentSchema),
  onsiteSupport: z.array(staffOnsiteSupportSchema),
  parent: relatedTicketSchema.nullable(),
  children: z.array(relatedTicketSchema),
  mergedInto: relatedTicketSchema.nullable(),
  mergedFrom: z.array(relatedTicketSchema),
  asset: z.object({ id: z.string(), tag: z.string(), name: z.string(), assetType: z.string() }).nullable(),
  watchers: z.array(z.object({
    id: z.string(), email: z.string(), staffId: z.string().nullable(), createdAt: z.date(),
    staff: z.object({ fullName: z.string() }).nullable(),
  })),
});
const staffTicketUpdateResponseSchema = staffTicketBaseSchema.extend({
  company: z.object({ name: z.string() }),
  assignedTo: z.object({ id: z.string(), fullName: z.string() }).nullable(),
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
      return reply.status(404).send({ success: false, error: t(request, 'tickets.company_not_found') });
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
          error: t(request, 'tickets.portal_company_mismatch'),
        });
      }
    }

    // Email domain restriction (talep sahibi + CC)
    if (![body.email, ...(body.ccEmails ?? [])].every(email => isEmailDomainAllowed(company.allowedDomains, email))) {
      return reply.status(400).send({
        success: false,
        error: t(request, 'tickets.email_domain_not_allowed'),
      });
    }

    // Kullanıcı kaydı, SLA, bildirimler ve SSE — e-posta kanalıyla ortak.
    const ticket = await createRequesterTicket(app.prisma, { ...body, source: 'portal' }, {
      queueEmail, queueSms, broadcastStaff: broadcastToStaff,
    });

    reply.status(201).send({
      success: true,
      data: {
        ticketNumber: ticket.ticketNumber,
        accessToken: ticket.accessToken,
        trackingUrl: trackingUrlFor(ticket.accessToken),
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
          slaPausedAt: true,
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
        parent: { select: relatedTicketSelect },
        children: { select: relatedTicketSelect, orderBy: { createdAt: 'asc' } },
        mergedInto: { select: relatedTicketSelect },
        mergedFrom: { select: relatedTicketSelect, orderBy: { createdAt: 'asc' } },
        asset: { select: { id: true, tag: true, name: true, assetType: true } },
        watchers: {
          select: { id: true, email: true, staffId: true, createdAt: true, staff: { select: { fullName: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!ticket) {
      return reply.status(404).send({ success: false, error: t(request, 'tickets.ticket_not_found') });
    }

    // Company scope check
    const scopeIds = await getStaffCompanyScope(app.prisma, request.staffUser!.id, request.staffUser!.role);
    if (scopeIds && !scopeIds.includes(ticket.companyId)) {
      return reply.status(403).send({ success: false, error: t(request, 'tickets.ticket_access_denied') });
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
      return reply.status(404).send({ success: false, error: t(request, 'tickets.ticket_not_found') });
    }

    // Şirket kapsamı — GET /:id bunu yapıyordu, PUT yapmıyordu. Yani kapsam dışı
    // bir ticket okunamıyor ama id'si bilindiğinde DEĞİŞTİRİLEBİLİYORDU: durum,
    // öncelik ve atama. Yazma yetkisi okuma yetkisinden geniş olamaz.
    const scopeIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    if (!isCompanyInScope(scopeIds, currentTicket.companyId)) {
      return reply.status(403).send({ success: false, error: t(request, 'tickets.ticket_access_denied') });
    }

    const historyEntries: Prisma.TicketHistoryUncheckedCreateWithoutTicketInput[] = [];
    const updateData: Prisma.TicketUncheckedUpdateInput = {};

    if (body.status && body.status !== currentTicket.status) {
      // İlk yanıt / çözüm zamanları, SLA duraklatma ve erişim linki süresi tek
      // yerde hesaplanır (bkz. utils/ticket-lifecycle.ts).
      const slaContext = await loadCompanySlaContext(app.prisma, currentTicket.companyId);
      const plan = planStatusTransition(
        currentTicket,
        body.status,
        new Date(),
        calendarFor(slaContext, currentTicket.priority),
        { id: staffUser.id },
      );
      Object.assign(updateData, plan.data);
      historyEntries.push(...plan.history);
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

    // Yaygın arıza: üst ticket'ın durumu alt ticket'lara da uygulanır (her biri
    // kendi SLA/yaşam döngüsü kurallarıyla). Kapalı/birleştirilmiş alt ticket'lara dokunulmaz.
    if (body.applyToChildren && body.status && body.status !== currentTicket.status) {
      const children = await app.prisma.ticket.findMany({
        where: { parentId: id, mergedIntoId: null, status: { notIn: [TicketStatus.closed, body.status] } },
      });
      const now = new Date();
      const slaContext = await loadCompanySlaContext(app.prisma, currentTicket.companyId);
      for (const child of children) {
        const plan = planStatusTransition(child, body.status, now, calendarFor(slaContext, child.priority), { id: staffUser.id });
        await app.prisma.ticket.update({
          where: { id: child.id },
          data: {
            ...plan.data,
            history: { create: [...plan.history, { action: 'status_from_parent', field: 'status', newValue: currentTicket.ticketNumber, createdById: staffUser.id }] },
          },
        });
        await emitTicketChanges(app.prisma, child.id, child, { status: body.status });
        await maybeSendSurvey(app.prisma, child.id, queueEmail);
        broadcastToStaff('ticket_updated', { id: child.id, ticketNumber: child.ticketNumber, status: body.status }, child.companyId);
        broadcastToTicket(child.accessToken, 'ticket_updated', { status: body.status, priority: child.priority });
      }
    }

    await emitTicketChanges(app.prisma, ticket.id, currentTicket, {
      status: body.status, priority: body.priority, assignedToId: body.assignedToId, assigneeName: ticket.assignedTo?.fullName,
    });
    if (body.status) await maybeSendSurvey(app.prisma, ticket.id, queueEmail);

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

    // Company scope restriction
    const scopeCompanyIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    const scopeWhere = scopeCompanyIds ? { companyId: { in: scopeCompanyIds } } : {};

    // Toplu güncelleme eskiden tek bir `updateMany` idi: durum değişse de ilk
    // yanıt/çözüm zamanı, SLA duraklatma, erişim linki süresi ve geçmiş kaydı
    // atlanıyordu. Artık her ticket tekil güncellemeyle aynı planlayıcıdan geçer.
    const tickets = await app.prisma.ticket.findMany({
      where: { id: { in: body.ticketIds }, ...scopeWhere },
    });
    const slaContextFor = createSlaContextCache(app.prisma);
    const now = new Date();

    await app.prisma.$transaction(async (tx) => {
      for (const ticket of tickets) {
        const data: Prisma.TicketUncheckedUpdateInput = {};
        const history: Prisma.TicketHistoryUncheckedCreateWithoutTicketInput[] = [];

        if (body.status && body.status !== ticket.status) {
          const plan = planStatusTransition(
            ticket,
            body.status,
            now,
            calendarFor(await slaContextFor(ticket.companyId), ticket.priority),
            { id: staffUser.id },
          );
          Object.assign(data, plan.data);
          history.push(...plan.history);
        }
        if (body.priority && body.priority !== ticket.priority) {
          data.priority = body.priority;
          history.push({ action: 'priority_changed', field: 'priority', oldValue: ticket.priority, newValue: body.priority, createdById: staffUser.id });
        }
        if (body.assignedToId !== undefined && body.assignedToId !== ticket.assignedToId) {
          data.assignedToId = body.assignedToId;
          history.push({ action: 'assigned', field: 'assignedToId', oldValue: ticket.assignedToId, newValue: body.assignedToId, createdById: staffUser.id });
        }
        if (history.length === 0) continue;

        await tx.ticket.update({
          where: { id: ticket.id },
          data: { ...data, history: { create: history } },
        });
      }
    });

    for (const ticket of tickets) {
      await emitTicketChanges(app.prisma, ticket.id, ticket, { status: body.status, priority: body.priority, assignedToId: body.assignedToId });
      if (body.status) await maybeSendSurvey(app.prisma, ticket.id, queueEmail);
      broadcastToStaff('ticket_updated', { id: ticket.id, ticketNumber: ticket.ticketNumber }, ticket.companyId);
    }

    reply.send({
      success: true,
      data: {
        updated: tickets.length,
        requested: body.ticketIds.length,
        skipped: body.ticketIds.length - tickets.length,
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
      return reply.status(404).send({ success: false, error: t(request, 'tickets.ticket_not_found') });
    }

    // Şirket kapsamı — bu uç da kapsamsızdı: kapsam dışı bir ticket'a dosya
    // eklenebiliyordu ve ek, o ticket'ın public takip linkinden servis ediliyor.
    const scopeIds = await getStaffCompanyScope(app.prisma, request.staffUser!.id, request.staffUser!.role);
    if (!isCompanyInScope(scopeIds, ticket.companyId)) {
      return reply.status(403).send({ success: false, error: t(request, 'tickets.ticket_access_denied') });
    }

    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ success: false, error: t(request, 'tickets.file_required') });
    }

    if (!isAllowedMimeType(file.mimetype)) {
      return reply.status(400).send({ success: false, error: t(request, 'tickets.unsupported_file_type') });
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
        error: t(request, 'tickets.max_attachments', { count: ATTACHMENT_LIMITS.maxCount }),
      });
    }

    const buffer = await file.toBuffer();

    // İçerik doğrulaması: beyan edilen MIME gerçek dosya imzasıyla tutarlı mı.
    // Tür karıştırma (image/png diyip başka içerik gönderme) diske yazılmadan durur.
    if (!isBufferConsistentWithMime(buffer, file.mimetype)) {
      return reply.status(400).send({ success: false, error: t(request, 'tickets.file_content_mismatch') });
    }

    const totalAfter = (existing._sum.fileSize ?? 0) + buffer.length;
    if (totalAfter > ATTACHMENT_LIMITS.maxTotalBytes) {
      const mb = Math.floor(ATTACHMENT_LIMITS.maxTotalBytes / (1024 * 1024));
      return reply.status(400).send({
        success: false,
        error: t(request, 'tickets.max_total_attachment_size', { mb }),
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
    const { q, companyId } = request.query;
    if (!q || q.length < 2) {
      return reply.send({ success: true, data: [] });
    }

    const staffUser = request.staffUser!;
    const scopeCompanyIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    // companyId filtresi kapsamla KESİŞTİRİLİR (üzerine yazmak yetki aşımı olurdu).
    if (companyId && !isCompanyInScope(scopeCompanyIds, companyId)) {
      return reply.send({ success: true, data: [] });
    }
    const scopeWhere = companyId
      ? { companyId }
      : scopeCompanyIds ? { companyId: { in: scopeCompanyIds } } : {};

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
