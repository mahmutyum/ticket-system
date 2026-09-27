import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Prisma, TicketStatus } from '@prisma/client';
import { queueEmail } from '../../jobs/queue.js';
import { broadcastToStaff, broadcastToTicket } from '../../services/sse.service.js';
import { calendarFor, loadCompanySlaContext } from '../../services/sla-context.js';
import { isEmailDomainAllowed } from '../../services/ticket-intake.js';
import { mergeError, parentError } from '../../services/ticket-relations.js';
import { commonErrorResponses, errorResponseSchema, successResponseSchema } from '../../utils/api-schema.js';
import { getStaffCompanyScope, isCompanyInScope } from '../../utils/staff-scope.js';
import { planStatusTransition } from '../../utils/ticket-lifecycle.js';
import { emailSchema } from '../../utils/validation.js';
import { t } from '../../i18n/index.js';

/**
 * Ticket ilişkileri: birleştirme, üst/alt ticket, izleyiciler (CC).
 *
 * Her uçta şirket kapsamı denetlenir; iki ticket'ı ilişkilendiren uçlarda İKİSİ de
 * çağıranın kapsamında olmalı ve aynı şirkete ait olmalıdır.
 */

const idParams = z.object({ id: z.string().min(1).max(128) });
const watcherParams = idParams.extend({ watcherId: z.string().min(1).max(128) });

const relationSelect = {
  id: true, ticketNumber: true, companyId: true, status: true, parentId: true, mergedIntoId: true,
  createdByEmail: true, accessToken: true, locale: true, priority: true,
  firstRespondedAt: true, resolvedAt: true, slaResponseDue: true, slaResolveDue: true,
  slaResponseMet: true, slaResolveMet: true, slaResponseWarnAt: true, slaResolveWarnAt: true,
  slaPausedAt: true, slaPausedMinutes: true,
  createdBy: { select: { fullName: true } },
} satisfies Prisma.TicketSelect;

const watcherSchema = z.object({
  id: z.string(), email: z.string(), staffId: z.string().nullable(), createdAt: z.date(),
  staff: z.object({ fullName: z.string() }).nullable(),
});

export const relationRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Ticket'ı kapsam denetimiyle yükler; yoksa/kapsam dışıysa yanıtı gönderip null döner. */
  async function loadInScope(request: FastifyRequest, reply: FastifyReply, id: string) {
    const ticket = await app.prisma.ticket.findUnique({ where: { id }, select: relationSelect });
    if (!ticket) {
      reply.status(404).send({ success: false, error: t(request, 'tickets.ticket_not_found') });
      return null;
    }
    const staff = request.staffUser!;
    const scope = await getStaffCompanyScope(app.prisma, staff.id, staff.role);
    if (!isCompanyInScope(scope, ticket.companyId)) {
      reply.status(403).send({ success: false, error: t(request, 'tickets.ticket_access_denied') });
      return null;
    }
    return ticket;
  }

  const audit = (request: FastifyRequest) => ({ id: request.staffUser!.id });

  // ==================== BİRLEŞTİRME ====================
  app.post('/:id/merge', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: {
      tags: ['Tickets'],
      summary: 'Ticket\'ı başka bir ticket\'a birleştirir',
      params: idParams,
      body: z.object({ targetId: z.string().min(1).max(128) }),
      response: { 200: successResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const source = await loadInScope(request, reply, request.params.id);
    if (!source) return;
    const target = await loadInScope(request, reply, request.body.targetId);
    if (!target) return;

    const error = mergeError(source, target);
    if (error) return reply.status(400).send({ success: false, error: t(request, error) });

    const now = new Date();
    const calendar = calendarFor(await loadCompanySlaContext(app.prisma, source.companyId), source.priority);
    const close = source.status !== TicketStatus.closed
      ? planStatusTransition(source, TicketStatus.closed, now, calendar, audit(request))
      : { data: {}, history: [] };

    await app.prisma.$transaction(async (tx) => {
      // Konuşma ve dosyalar hedefe taşınır; geçmiş kaynakta kalır (kim neyi ne zaman yaptı).
      await tx.ticketNote.updateMany({ where: { ticketId: source.id }, data: { ticketId: target.id } });
      await tx.attachment.updateMany({ where: { ticketId: source.id }, data: { ticketId: target.id } });

      // Kaynağın talep sahibi ve izleyicileri hedefte CC olur: artık oradan bilgilendirilirler.
      const sourceWatchers = await tx.ticketWatcher.findMany({ where: { ticketId: source.id } });
      const cc = [
        ...(source.createdByEmail.toLowerCase() !== target.createdByEmail.toLowerCase()
          ? [{ email: source.createdByEmail.toLowerCase(), staffId: null }]
          : []),
        ...sourceWatchers.map(w => ({ email: w.email, staffId: w.staffId })),
      ].filter(w => w.email !== target.createdByEmail.toLowerCase());
      if (cc.length) {
        await tx.ticketWatcher.createMany({
          data: cc.map(w => ({ ...w, ticketId: target.id, addedBy: request.staffUser!.email })),
          skipDuplicates: true,
        });
      }

      // Kaynağın alt ticket'ları hedefe bağlanır (hedef bir alt ticket ise bağ kopar — tek seviye).
      await tx.ticket.updateMany({ where: { parentId: source.id }, data: { parentId: target.parentId ? null : target.id } });

      await tx.ticket.update({
        where: { id: source.id },
        data: {
          ...close.data,
          mergedIntoId: target.id,
          parentId: null,
          history: {
            create: [
              ...close.history,
              { action: 'merged_into', field: 'ticket', newValue: target.ticketNumber, createdById: request.staffUser!.id },
            ],
          },
        },
      });
      await tx.ticketHistory.create({
        data: { ticketId: target.id, action: 'merged_from', field: 'ticket', newValue: source.ticketNumber, createdById: request.staffUser!.id },
      });
    });

    await queueEmail({
      to: source.createdByEmail,
      templateSlug: 'ticket_merged',
      variables: {
        userName: source.createdBy?.fullName ?? source.createdByEmail,
        ticketNumber: source.ticketNumber,
        targetTicketNumber: target.ticketNumber,
      },
      ticketId: source.id,
      companyId: source.companyId,
    });
    broadcastToStaff('ticket_updated', { id: source.id, ticketNumber: source.ticketNumber, status: TicketStatus.closed }, source.companyId);
    broadcastToStaff('ticket_updated', { id: target.id, ticketNumber: target.ticketNumber }, target.companyId);
    broadcastToTicket(source.accessToken, 'ticket_updated', { status: TicketStatus.closed });
    reply.send({ success: true });
  });

  // ==================== ÜST / ALT ====================
  app.put('/:id/parent', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Tickets'],
      summary: 'Ticket\'ın üst ticket\'ını ayarlar veya kaldırır',
      params: idParams,
      body: z.object({ parentId: z.string().min(1).max(128).nullable() }),
      response: { 200: successResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const child = await loadInScope(request, reply, request.params.id);
    if (!child) return;

    if (request.body.parentId === null) {
      if (child.parentId) {
        await app.prisma.ticket.update({
          where: { id: child.id },
          data: { parentId: null, history: { create: { action: 'parent_removed', field: 'ticket', createdById: request.staffUser!.id } } },
        });
      }
      return reply.send({ success: true });
    }

    const parent = await loadInScope(request, reply, request.body.parentId);
    if (!parent) return;
    const childHasChildren = (await app.prisma.ticket.count({ where: { parentId: child.id } })) > 0;
    const error = parentError(child, parent, childHasChildren);
    if (error) return reply.status(400).send({ success: false, error: t(request, error) });

    await app.prisma.$transaction([
      app.prisma.ticket.update({
        where: { id: child.id },
        data: {
          parentId: parent.id,
          history: { create: { action: 'parent_set', field: 'ticket', newValue: parent.ticketNumber, createdById: request.staffUser!.id } },
        },
      }),
      app.prisma.ticketHistory.create({
        data: { ticketId: parent.id, action: 'child_added', field: 'ticket', newValue: child.ticketNumber, createdById: request.staffUser!.id },
      }),
    ]);
    reply.send({ success: true });
  });

  // ==================== İZLEYİCİLER ====================
  app.post('/:id/watchers', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Tickets'],
      summary: 'Ticket\'a izleyici (CC ya da personel) ekler',
      params: idParams,
      body: z.union([
        z.object({ email: emailSchema }),
        z.object({ staffId: z.string().min(1).max(128) }),
      ]),
      response: { 201: z.object({ success: z.literal(true), data: watcherSchema }), ...commonErrorResponses, 409: errorResponseSchema },
    },
  }, async (request, reply) => {
    const ticket = await loadInScope(request, reply, request.params.id);
    if (!ticket) return;
    const body = request.body;

    let data: { email: string; staffId: string | null };
    if ('staffId' in body) {
      // Personel izleyici: aktif olmalı ve bu şirketi görebilmeli (aksi hâlde kapsam dışı
      // bir ticket'ın bildirimlerini alırdı).
      const staff = await app.prisma.staff.findUnique({ where: { id: body.staffId }, select: { id: true, email: true, role: true, isActive: true } });
      if (!staff?.isActive) return reply.status(400).send({ success: false, error: t(request, 'tickets.watcher_invalid_staff') });
      const scope = await getStaffCompanyScope(app.prisma, staff.id, staff.role);
      if (!isCompanyInScope(scope, ticket.companyId)) {
        return reply.status(400).send({ success: false, error: t(request, 'tickets.watcher_invalid_staff') });
      }
      data = { email: staff.email.toLowerCase(), staffId: staff.id };
    } else {
      const email = body.email.toLowerCase();
      if (email === ticket.createdByEmail.toLowerCase()) {
        return reply.status(400).send({ success: false, error: t(request, 'tickets.watcher_is_requester') });
      }
      // CC da şirketin izinli domain kuralına tabidir — sistem dışarıya bildirim rölesi olmasın.
      const company = await app.prisma.company.findUnique({ where: { id: ticket.companyId }, select: { allowedDomains: true } });
      if (!isEmailDomainAllowed(company?.allowedDomains, email)) {
        return reply.status(400).send({ success: false, error: t(request, 'tickets.email_domain_not_allowed') });
      }
      data = { email, staffId: null };
    }

    try {
      const watcher = await app.prisma.ticketWatcher.create({
        data: { ticketId: ticket.id, ...data, addedBy: request.staffUser!.email },
        select: { id: true, email: true, staffId: true, createdAt: true, staff: { select: { fullName: true } } },
      });
      await app.prisma.ticketHistory.create({
        data: { ticketId: ticket.id, action: 'watcher_added', field: 'watcher', newValue: data.email, createdById: request.staffUser!.id },
      });
      reply.status(201).send({ success: true, data: watcher });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.status(409).send({ success: false, error: t(request, 'tickets.watcher_exists') });
      }
      throw err;
    }
  });

  app.delete('/:id/watchers/:watcherId', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Tickets'],
      summary: 'Ticket izleyicisini kaldırır',
      params: watcherParams,
      response: { 200: successResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const ticket = await loadInScope(request, reply, request.params.id);
    if (!ticket) return;
    // ticketId koşulu: başka ticket'ın izleyicisi id ile silinemesin.
    const watcher = await app.prisma.ticketWatcher.findFirst({ where: { id: request.params.watcherId, ticketId: ticket.id } });
    if (!watcher) return reply.status(404).send({ success: false, error: t(request, 'tickets.watcher_not_found') });
    await app.prisma.ticketWatcher.delete({ where: { id: watcher.id } });
    await app.prisma.ticketHistory.create({
      data: { ticketId: ticket.id, action: 'watcher_removed', field: 'watcher', newValue: watcher.email, createdById: request.staffUser!.id },
    });
    reply.send({ success: true });
  });
};
