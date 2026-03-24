import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

export const publicRoutes: FastifyPluginAsync = async (app) => {
  // Public: View ticket by access token
  app.get('/ticket/:accessToken', async (request, reply) => {
    const { accessToken } = request.params as { accessToken: string };

    const ticket = await app.prisma.ticket.findUnique({
      where: { accessToken },
      include: {
        company: { select: { name: true } },
        location: { select: { name: true } },
        category: { select: { name: true } },
        assignedTo: { select: { fullName: true } },
        customValues: { include: { customField: { select: { fieldLabel: true } } } },
        notes: {
          where: { isInternal: false }, // Only public notes
          include: { createdBy: { select: { fullName: true } } },
          orderBy: { createdAt: 'asc' },
        },
        history: {
          orderBy: { createdAt: 'asc' },
          select: {
            action: true,
            field: true,
            oldValue: true,
            newValue: true,
            createdAt: true,
          },
        },
        onsiteSupport: {
          where: { status: { not: 'cancelled' } },
          select: {
            type: true,
            scheduledAt: true,
            scheduledEnd: true,
            roomInfo: true,
            status: true,
          },
        },
      },
    });

    if (!ticket) {
      return reply.status(404).send({ success: false, error: 'Ticket bulunamadı' });
    }

    reply.send({ success: true, data: ticket });
  });

  // Public: Reply to ticket
  app.post('/ticket/:accessToken/reply', async (request, reply) => {
    const { accessToken } = request.params as { accessToken: string };
    const body = z.object({
      content: z.string().min(1),
    }).parse(request.body);

    const ticket = await app.prisma.ticket.findUnique({
      where: { accessToken },
      select: { id: true, createdByEmail: true },
    });

    if (!ticket) {
      return reply.status(404).send({ success: false, error: 'Ticket bulunamadı' });
    }

    // Create a history entry for user reply
    await app.prisma.ticketHistory.create({
      data: {
        ticketId: ticket.id,
        action: 'user_reply',
        newValue: body.content,
        createdByEmail: ticket.createdByEmail,
      },
    });

    // If waiting for user response, move to open
    await app.prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        status: 'open',
        updatedAt: new Date(),
      },
    });

    reply.send({ success: true });
  });

  // Public: List tickets by email
  app.get('/tickets', async (request, reply) => {
    const { email } = request.query as { email: string };

    if (!email) {
      return reply.status(400).send({ success: false, error: 'Email gerekli' });
    }

    const tickets = await app.prisma.ticket.findMany({
      where: { createdByEmail: email },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        ticketNumber: true,
        subject: true,
        status: true,
        priority: true,
        accessToken: true,
        createdAt: true,
        updatedAt: true,
        company: { select: { name: true } },
        category: { select: { name: true } },
      },
    });

    reply.send({ success: true, data: tickets });
  });
};
