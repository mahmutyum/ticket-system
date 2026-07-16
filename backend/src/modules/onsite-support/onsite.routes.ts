import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Prisma, OnsiteType, OnsiteStatus } from '@prisma/client';
import { queueEmail } from '../../jobs/queue.js';
import { ONSITE_TYPE_LABELS } from '../../config/constants.js';
import { getStaffCompanyScope } from '../../utils/staff-scope.js';
import { createAuditLog } from '../../middleware/audit.js';
import { formatTrDateTime } from '../../utils/format.js';

const onsiteCreateSchema = z.object({
  ticketId: z.string().cuid(),
  locationId: z.string().cuid(),
  type: z.nativeEnum(OnsiteType),
  scheduledAt: z.string().datetime(),
  scheduledEnd: z.string().datetime().optional(),
  roomInfo: z.string().optional(),
  floorInfo: z.string().optional(),
  notes: z.string().optional(),
});

const onsiteUpdateSchema = z.object({
  scheduledAt: z.string().datetime().optional(),
  scheduledEnd: z.string().datetime().optional(),
  status: z.nativeEnum(OnsiteStatus).optional(),
  notes: z.string().optional(),
  roomInfo: z.string().optional(),
});
const idParamsSchema = z.object({ id: z.string().min(1).max(128) });
const onsiteListQuerySchema = z.object({
  status: z.nativeEnum(OnsiteStatus).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
const calendarQuerySchema = z.object({ week: z.string().datetime().optional() });

export const onsiteRoutes: FastifyPluginAsyncZod = async (app) => {
  // Create onsite support
  app.post('/', {
    preValidation: [app.authenticate],
    schema: { body: onsiteCreateSchema, tags: ['Onsite Support'], summary: 'Yerinde destek randevusu oluştur' },
  }, async (request, reply) => {
    const body = request.body;
    const staffUser = request.staffUser!;

    const ticket = await app.prisma.ticket.findUnique({
      where: { id: body.ticketId },
      select: { id: true, companyId: true, createdByEmail: true, accessToken: true, createdBy: { select: { fullName: true } } },
    });

    if (!ticket) {
      return reply.status(404).send({ success: false, error: 'Ticket bulunamadı' });
    }

    const scopeIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    if (scopeIds && !scopeIds.includes(ticket.companyId)) {
      return reply.status(403).send({ success: false, error: 'Bu talebe erişim yetkiniz yok' });
    }

    const onsite = await app.prisma.onsiteSupport.create({
      data: {
        ticketId: body.ticketId,
        locationId: body.locationId,
        type: body.type,
        scheduledAt: new Date(body.scheduledAt),
        scheduledEnd: body.scheduledEnd ? new Date(body.scheduledEnd) : undefined,
        roomInfo: body.roomInfo,
        floorInfo: body.floorInfo,
        notes: body.notes,
      },
      include: { location: true, ticket: { select: { ticketNumber: true } } },
    });

    // Add history entry
    await app.prisma.ticketHistory.create({
      data: {
        ticketId: body.ticketId,
        action: 'onsite_scheduled',
        newValue: `${body.type} - ${body.scheduledAt}`,
        createdById: request.staffUser!.id,
      },
    });

    // Notify employee
    const scheduledDate = formatTrDateTime(body.scheduledAt);
    const supportType = ONSITE_TYPE_LABELS[body.type] || body.type;
    const locationInfo = body.roomInfo
      ? `${onsite.location.name} - ${body.roomInfo}`
      : onsite.location.name;

    let extraNote: string;
    if (body.type === 'come_to_it_room') {
      extraNote = `Lütfen belirtilen saatte IT odasına (${body.roomInfo || locationInfo}) geliniz.`;
    } else if (body.type === 'meeting_room') {
      extraNote = `Lütfen belirtilen saatte toplantı odasına (${body.roomInfo || locationInfo}) geliniz.`;
    } else {
      extraNote = 'IT ekibi belirtilen saatte size gelecektir.';
    }

    await queueEmail({
      to: ticket.createdByEmail,
      templateSlug: 'onsite_scheduled',
      variables: {
        ticketNumber: onsite.ticket.ticketNumber,
        userName: ticket.createdBy?.fullName || ticket.createdByEmail,
        scheduledAt: scheduledDate,
        supportType,
        locationInfo,
        extraNote,
      },
      ticketId: body.ticketId,
      companyId: ticket.companyId,
    });

    reply.status(201).send({ success: true, data: onsite });
  });

  // List onsite support
  app.get('/', {
    preValidation: [app.authenticate],
    schema: { querystring: onsiteListQuerySchema, tags: ['Onsite Support'], summary: 'Yerinde destek randevularını listele' },
  }, async (request, reply) => {
    const query = request.query;
    const staffUser = request.staffUser!;

    const scopeCompanyIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);

    const where: Prisma.OnsiteSupportWhereInput = {};
    if (scopeCompanyIds) {
      where.ticket = { companyId: { in: scopeCompanyIds } };
    }
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.scheduledAt = {};
      if (query.from) where.scheduledAt.gte = new Date(query.from);
      if (query.to) where.scheduledAt.lte = new Date(query.to);
    }

    const onsiteList = await app.prisma.onsiteSupport.findMany({
      where,
      orderBy: { scheduledAt: 'asc' },
      include: {
        ticket: {
          select: {
            ticketNumber: true,
            subject: true,
            createdByEmail: true,
            createdBy: { select: { fullName: true, phone: true } },
          },
        },
        location: { select: { name: true, address: true, itRoom: true } },
      },
    });

    reply.send({ success: true, data: onsiteList });
  });

  // Update onsite support
  app.put('/:id', {
    preValidation: [app.authenticate],
    schema: { params: idParamsSchema, body: onsiteUpdateSchema, tags: ['Onsite Support'], summary: 'Yerinde destek randevusunu güncelle' },
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body;
    const staffUser = request.staffUser!;

    const existing = await app.prisma.onsiteSupport.findUnique({
      where: { id },
      include: { ticket: { select: { companyId: true } } },
    });
    if (!existing) {
      return reply.status(404).send({ success: false, error: 'Randevu bulunamadı' });
    }

    const scopeIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    if (scopeIds && !scopeIds.includes(existing.ticket.companyId)) {
      return reply.status(403).send({ success: false, error: 'Bu randevuya erişim yetkiniz yok' });
    }

    const updateData: Prisma.OnsiteSupportUpdateInput = {
      status: body.status,
      notes: body.notes,
      roomInfo: body.roomInfo,
    };
    if (body.scheduledAt) updateData.scheduledAt = new Date(body.scheduledAt);
    if (body.scheduledEnd) updateData.scheduledEnd = new Date(body.scheduledEnd);
    if (body.status === 'completed') updateData.completedAt = new Date();

    const onsite = await app.prisma.onsiteSupport.update({
      where: { id },
      data: updateData,
      include: { location: true, ticket: { select: { ticketNumber: true, id: true } } },
    });

    // Add history for status change
    if (body.status) {
      await app.prisma.ticketHistory.create({
        data: {
          ticketId: onsite.ticket.id,
          action: 'onsite_status_changed',
          newValue: body.status,
          createdById: request.staffUser!.id,
        },
      });
    }

    // Notify employee if schedule changed or cancelled
    if (body.scheduledAt || body.status === 'cancelled') {
      const ticket = await app.prisma.ticket.findUnique({
        where: { id: onsite.ticket.id },
        select: { companyId: true, createdByEmail: true, accessToken: true, createdBy: { select: { fullName: true } } },
      });

      if (ticket) {
        const scheduledDate = formatTrDateTime(body.scheduledAt || onsite.scheduledAt);

        await queueEmail({
          to: ticket.createdByEmail,
          templateSlug: 'onsite_scheduled',
          variables: {
            ticketNumber: onsite.ticket.ticketNumber,
            userName: ticket.createdBy?.fullName || ticket.createdByEmail,
            scheduledAt: scheduledDate,
            supportType: body.status === 'cancelled' ? 'İPTAL EDİLDİ' : ONSITE_TYPE_LABELS[onsite.type] || onsite.type,
            locationInfo: onsite.location.name,
            extraNote: body.status === 'cancelled'
              ? 'Yerinde destek randevunuz iptal edilmiştir.'
              : 'Yerinde destek randevunuz güncellendi.',
          },
          ticketId: onsite.ticket.id,
          companyId: ticket.companyId,
        });
      }
    }

    await createAuditLog({
      entityType: 'onsite_support',
      entityId: id,
      action: 'update',
      changes: body,
      performedBy: staffUser.email,
      ipAddress: request.headers['x-real-ip'] as string,
    });

    reply.send({ success: true, data: onsite });
  });

  // Calendar view
  app.get('/calendar', {
    preValidation: [app.authenticate],
    schema: { querystring: calendarQuerySchema, tags: ['Onsite Support'], summary: 'Haftalık yerinde destek takvimini getir' },
  }, async (request, reply) => {
    const { week } = request.query;
    const staffUser = request.staffUser!;

    const scopeCompanyIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);

    // Frontend, kullanıcının yerel saatine göre Pazartesi 00:00'ı hesaplayıp ISO olarak gönderir.
    // Burada o anı olduğu gibi başlangıç kabul edip 7 gün ekliyoruz; sunucu zaman diliminden
    // bağımsız tutarlı bir aralık elde etmek için yeniden "haftanın başına git" hesabı yapmıyoruz.
    let startDate: Date;
    if (week) {
      startDate = new Date(week);
    } else {
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      const dayOfWeek = startDate.getDay();
      startDate.setDate(startDate.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    }

    const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

    const scopeFilter = scopeCompanyIds
      ? { ticket: { companyId: { in: scopeCompanyIds } } }
      : {};

    const events = await app.prisma.onsiteSupport.findMany({
      where: {
        ...scopeFilter,
        scheduledAt: { gte: startDate, lt: endDate },
        status: { not: 'cancelled' },
      },
      include: {
        ticket: {
          select: {
            ticketNumber: true,
            subject: true,
            createdBy: { select: { fullName: true } },
          },
        },
        location: { select: { name: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    reply.send({ success: true, data: { startDate, endDate, events } });
  });
};
