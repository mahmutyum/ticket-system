import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { broadcastToStaff } from '../../services/sse.service.js';
import { queueEmail } from '../../jobs/queue.js';
import { saveFile, isAllowedMimeType } from '../../services/storage.service.js';
import { config } from '../../config/index.js';

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
          where: { isInternal: false },
          include: { createdBy: { select: { fullName: true } } },
          orderBy: { createdAt: 'asc' },
        },
        history: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            action: true,
            field: true,
            oldValue: true,
            newValue: true,
            createdAt: true,
          },
        },
        attachments: {
          select: { id: true, fileName: true, filePath: true, fileSize: true, createdAt: true },
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

  // Public: Reply to ticket — with IT notification
  app.post('/ticket/:accessToken/reply', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { accessToken } = request.params as { accessToken: string };
    const body = z.object({
      content: z.string().min(1),
    }).parse(request.body);

    const ticket = await app.prisma.ticket.findUnique({
      where: { accessToken },
      select: {
        id: true,
        ticketNumber: true,
        companyId: true,
        createdByEmail: true,
        assignedToId: true,
        status: true,
        assignedTo: { select: { email: true, fullName: true } },
      },
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
    const wasWaiting = ticket.status === 'waiting_user_response';
    if (wasWaiting) {
      await app.prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: 'open' },
      });
    }

    // SSE broadcast to staff
    broadcastToStaff('user_reply', {
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      email: ticket.createdByEmail,
      content: body.content.substring(0, 100),
    });

    // Notify assigned staff via email
    if (ticket.assignedTo?.email) {
      await queueEmail({
        to: ticket.assignedTo.email,
        templateSlug: 'user_reply',
        variables: {
          ticketNumber: ticket.ticketNumber,
          staffName: ticket.assignedTo.fullName,
          userEmail: ticket.createdByEmail,
          replyContent: body.content.substring(0, 500),
        },
        ticketId: ticket.id,
        companyId: ticket.companyId,
      });
    }

    reply.send({ success: true });
  });

  // Public: Upload attachment to ticket
  app.post('/ticket/:accessToken/attachments', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { accessToken } = request.params as { accessToken: string };

    const ticket = await app.prisma.ticket.findUnique({
      where: { accessToken },
      select: { id: true, createdByEmail: true, status: true },
    });

    if (!ticket) {
      return reply.status(404).send({ success: false, error: 'Ticket bulunamadı' });
    }

    if (['resolved', 'closed'].includes(ticket.status)) {
      return reply.status(400).send({ success: false, error: 'Kapalı taleplere dosya eklenemez' });
    }

    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ success: false, error: 'Dosya gerekli' });
    }

    if (!isAllowedMimeType(file.mimetype)) {
      return reply.status(400).send({ success: false, error: 'Desteklenmeyen dosya türü' });
    }

    const buffer = await file.toBuffer();
    const saved = await saveFile(buffer, file.filename, ticket.id);

    const attachment = await app.prisma.attachment.create({
      data: {
        ticketId: ticket.id,
        fileName: saved.fileName,
        filePath: saved.filePath,
        fileSize: saved.fileSize,
        mimeType: file.mimetype,
        uploadedBy: ticket.createdByEmail,
      },
    });

    reply.status(201).send({ success: true, data: attachment });
  });

  // Public: List tickets by email
  app.get('/tickets', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
  }, async (request, reply) => {
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
