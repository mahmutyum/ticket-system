import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { generateTicketNumber } from '../../utils/ticket-number.js';
import { paginationSchema, paginate, paginatedResponse } from '../../utils/pagination.js';
import { requiredText, optionalText, phoneSchema, emailSchema, LIMITS } from '../../utils/validation.js';
import { TicketStatus, Priority } from '@prisma/client';
import { queueEmail, queueSms } from '../../jobs/queue.js';
import { saveFile, isAllowedMimeType } from '../../services/storage.service.js';
import { config } from '../../config/index.js';
import { broadcastToStaff, broadcastToTicket } from '../../services/sse.service.js';
import { getStaffCompanyScope, resolveCompanyFilter } from '../../utils/staff-scope.js';

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
  status: z.string().optional(),
  priority: z.string().optional(),
  companyId: z.string().optional(),
  categoryId: z.string().optional(),
  assignedToId: z.string().optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export const ticketRoutes: FastifyPluginAsync = async (app) => {
  // PUBLIC: Create ticket
  app.post('/', {
    config: {
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
  }, async (request, reply) => {
    const body = ticketCreateSchema.parse(request.body);

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

    let slaResponseDue: Date | undefined;
    let slaResolveDue: Date | undefined;

    if (category?.slaResponseMinutes) {
      slaResponseDue = new Date(Date.now() + category.slaResponseMinutes * 60 * 1000);
    }
    if (category?.slaResolutionMinutes) {
      slaResolveDue = new Date(Date.now() + category.slaResolutionMinutes * 60 * 1000);
    }

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
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const query = ticketFilterSchema.parse(request.query);
    const { skip, take } = paginate(query);
    const staffUser = request.staffUser!;

    // Company scope restriction — istemciden gelen companyId filtresi kapsamla
    // kesiştirilir; doğrudan atanırsa kapsamı ezer ve yetki aşımına yol açar.
    const scopeCompanyIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);

    const where: any = { ...resolveCompanyFilter(scopeCompanyIds, query.companyId) };
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
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

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

    reply.send({ success: true, data: ticket });
  });

  // STAFF: Update ticket (status, priority, assignment)
  app.put('/:id', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = ticketUpdateSchema.parse(request.body);
    const staffUser = request.staffUser!;

    const currentTicket = await app.prisma.ticket.findUnique({ where: { id } });
    if (!currentTicket) {
      return reply.status(404).send({ success: false, error: 'Ticket bulunamadı' });
    }

    const historyEntries: any[] = [];
    const updateData: any = {};

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
        updateData.slaResponseMet = currentTicket.slaResponseDue
          ? new Date() <= currentTicket.slaResponseDue
          : null;
      }
      if (body.status === TicketStatus.resolved) {
        updateData.resolvedAt = new Date();
        updateData.slaResolveMet = currentTicket.slaResolveDue
          ? new Date() <= currentTicket.slaResolveDue
          : null;
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

    reply.send({ success: true, data: ticket });
  });

  // STAFF: Bulk update tickets
  app.post('/bulk', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const body = z.object({
      ticketIds: z.array(z.string().cuid()),
      status: z.nativeEnum(TicketStatus).optional(),
      assignedToId: z.string().cuid().nullable().optional(),
      priority: z.nativeEnum(Priority).optional(),
    }).parse(request.body);

    const staffUser = request.staffUser!;

    const updateData: any = {};
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
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const ticket = await app.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) {
      return reply.status(404).send({ success: false, error: 'Ticket bulunamadı' });
    }

    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ success: false, error: 'Dosya gerekli' });
    }

    if (!isAllowedMimeType(file.mimetype)) {
      return reply.status(400).send({ success: false, error: 'Desteklenmeyen dosya türü' });
    }

    const buffer = await file.toBuffer();
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

    reply.status(201).send({ success: true, data: attachment });
  });

  // STAFF: Search tickets
  app.get('/search', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { q } = request.query as { q: string };
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
