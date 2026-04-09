import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { queueEmail } from '../../jobs/queue.js';
import { config } from '../../config/index.js';
import { broadcastToStaff, broadcastToTicket } from '../../services/sse.service.js';

const noteCreateSchema = z.object({
  content: z.string().min(1),
  isInternal: z.boolean().default(false),
});

export const noteRoutes: FastifyPluginAsync = async (app) => {
  // STAFF: Add note to ticket
  app.post('/:ticketId/notes', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { ticketId } = request.params as { ticketId: string };
    const body = noteCreateSchema.parse(request.body);
    const staffUser = request.staffUser!;

    const ticket = await app.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, ticketNumber: true, createdByEmail: true, accessToken: true, companyId: true },
    });
    if (!ticket) {
      return reply.status(404).send({ success: false, error: 'Ticket bulunamadı' });
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
    await app.prisma.ticketHistory.create({
      data: {
        ticketId,
        action: body.isInternal ? 'internal_note_added' : 'note_added',
        newValue: body.content.substring(0, 100),
        createdById: staffUser.id,
      },
    });

    // SSE broadcast
    broadcastToStaff('note_added', {
      ticketId,
      ticketNumber: ticket.ticketNumber,
      isInternal: body.isInternal,
      staffName: note.createdBy.fullName,
    });

    // If not internal, notify user and broadcast to public
    if (!body.isInternal) {
      broadcastToTicket(ticket.accessToken, 'note_added', {
        content: body.content,
        staffName: note.createdBy.fullName,
        createdAt: note.createdAt,
      });

      const trackingUrl = `${config.APP_URL}/ticket/${ticket.accessToken}`;
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
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { ticketId } = request.params as { ticketId: string };

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
