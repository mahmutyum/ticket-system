import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requiredText, LIMITS } from '../../utils/validation.js';
import { queueEmail } from '../../jobs/queue.js';
import { config } from '../../config/index.js';
import { broadcastToStaff, broadcastToTicket } from '../../services/sse.service.js';
import { getStaffCompanyScope } from '../../utils/staff-scope.js';
import { StaffRole } from '@prisma/client';
import { commonErrorResponses } from '../../utils/api-schema.js';

const noteCreateSchema = z.object({
  content: requiredText({ ...LIMITS.noteContent, label: 'Not' }),
  isInternal: z.boolean().default(false),
});
const ticketNotesParamsSchema = z.object({ ticketId: z.string().min(1).max(128) });
const noteSchema = z.object({
  id: z.string(),
  ticketId: z.string(),
  content: z.string(),
  isInternal: z.boolean(),
  createdById: z.string(),
  createdAt: z.date(),
  createdBy: z.object({ fullName: z.string(), role: z.nativeEnum(StaffRole) }),
});
const responseOf = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });

export const noteRoutes: FastifyPluginAsyncZod = async (app) => {
  // STAFF: Add note to ticket
  app.post('/:ticketId/notes', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Ticket Notes'],
      summary: 'Destek talebine not ekler',
      params: ticketNotesParamsSchema,
      body: noteCreateSchema,
      response: { 201: responseOf(noteSchema), ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const { ticketId } = request.params;
    const body = request.body;
    const staffUser = request.staffUser!;

    const ticket = await app.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, ticketNumber: true, createdByEmail: true, accessToken: true, companyId: true },
    });
    if (!ticket) {
      return reply.status(404).send({ success: false, error: 'Ticket bulunamadı' });
    }

    const scopeIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    if (scopeIds && !scopeIds.includes(ticket.companyId)) {
      return reply.status(403).send({ success: false, error: 'Bu talebe erişim yetkiniz yok' });
    }

    const note = await app.prisma.ticketNote.create({
      data: {
        ticketId,
        content: body.content,
        isInternal: body.isInternal,
        createdById: staffUser.id,
      },
      include: {
        createdBy: { select: { fullName: true, role: true } },
      },
    });

    // Add history entry
    //
    // İÇ notların METNİ history'ye YAZILMAZ. Yazılıyordu ve public ticket
    // uç noktası history'yi döndürdüğü için `notes: { where: { isInternal: false } }`
    // filtresi anlamsız hale geliyordu: link'i olan herkes her iç notun ilk 100
    // karakterini okuyabiliyordu. History bir eylem kaydıdır; notun içeriği
    // TicketNote'ta yaşar ve erişimi orada denetlenir.
    await app.prisma.ticketHistory.create({
      data: {
        ticketId,
        action: body.isInternal ? 'internal_note_added' : 'note_added',
        newValue: body.isInternal ? null : body.content.substring(0, 100),
        createdById: staffUser.id,
      },
    });

    // SSE broadcast
    broadcastToStaff('note_added', {
      ticketId,
      ticketNumber: ticket.ticketNumber,
      isInternal: body.isInternal,
      staffName: note.createdBy.fullName,
    }, ticket.companyId);

    // If not internal, notify user and broadcast to public
    if (!body.isInternal) {
      broadcastToTicket(ticket.accessToken, 'note_added', {
        content: body.content,
        staffName: note.createdBy.fullName,
        createdAt: note.createdAt,
      });

      const trackingUrl = `${config.CANONICAL_URL}/ticket/${ticket.accessToken}`;
      await queueEmail({
        to: ticket.createdByEmail,
        templateSlug: 'note_added',
        variables: {
          ticketNumber: ticket.ticketNumber,
          userName: ticket.createdByEmail,
          trackingUrl,
        },
        ticketId: ticket.id,
        companyId: ticket.companyId,
      });
    }

    reply.status(201).send({ success: true, data: note });
  });

  // STAFF: Get notes for ticket
  app.get('/:ticketId/notes', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Ticket Notes'],
      summary: 'Destek talebinin notlarını listeler',
      params: ticketNotesParamsSchema,
      response: { 200: responseOf(z.array(noteSchema)), ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const { ticketId } = request.params;
    const staffUser = request.staffUser!;

    const ticket = await app.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { companyId: true },
    });
    if (!ticket) {
      return reply.status(404).send({ success: false, error: 'Ticket bulunamadı' });
    }

    const scopeIds = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    if (scopeIds && !scopeIds.includes(ticket.companyId)) {
      return reply.status(403).send({ success: false, error: 'Bu talebe erişim yetkiniz yok' });
    }

    const notes = await app.prisma.ticketNote.findMany({
      where: { ticketId },
      include: {
        createdBy: { select: { fullName: true, role: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    reply.send({ success: true, data: notes });
  });
};
