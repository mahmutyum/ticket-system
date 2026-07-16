import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { broadcastToStaff } from '../../services/sse.service.js';
import { queueEmail } from '../../jobs/queue.js';
import { saveFile, isAllowedMimeType } from '../../services/storage.service.js';
import { requiredText, emailSchema, LIMITS } from '../../utils/validation.js';
import { commonErrorResponses, successResponseSchema } from '../../utils/api-schema.js';

/**
 * Public takip linkinin süresi dolmuş mu?
 *
 * `null` = süresiz (ticket açık). Kapanışta uygulama katmanı bir son verir —
 * link access_log'a, e-postalara ve tarayıcı geçmişine düştüğü için sonsuza dek
 * geçerli kalmamalı.
 *
 * Süresi dolan bir link 404 döner; "süresi doldu" denmez, çünkü o bile geçerli
 * bir ticket'ın varlığını doğrular. Talep eden /public/track (ticket no +
 * e-posta) ile yeniden erişim alabilir.
 */
function isAccessExpired(expiresAt: Date | null): boolean {
  return expiresAt !== null && expiresAt < new Date();
}

const accessTokenParamsSchema = z.object({ accessToken: z.string().min(1).max(128) });
const publicReplySchema = z.object({
  content: requiredText({ ...LIMITS.noteContent, label: 'Yanıt' }),
});
const ticketTrackSchema = z.object({
  ticketNumber: z.string().trim().min(1).max(50),
  email: emailSchema,
});

const publicTicketSchema = z.object({
  id: z.string(),
  ticketNumber: z.string(),
  subject: z.string(),
  description: z.string(),
  priority: z.string(),
  status: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  company: z.object({ name: z.string() }),
  location: z.object({ name: z.string() }),
  category: z.object({ name: z.string() }),
  assignedTo: z.object({ fullName: z.string() }).nullable(),
  customValues: z.array(z.object({
    id: z.string(),
    value: z.string(),
    customField: z.object({ fieldLabel: z.string() }),
  })),
  notes: z.array(z.object({
    id: z.string(),
    content: z.string(),
    createdAt: z.date(),
    createdBy: z.object({ fullName: z.string() }),
  })),
  history: z.array(z.object({
    id: z.string(),
    action: z.string(),
    field: z.string().nullable(),
    oldValue: z.string().nullable(),
    newValue: z.string().nullable(),
    createdAt: z.date(),
  })),
  attachments: z.array(z.object({
    id: z.string(),
    fileName: z.string(),
    fileSize: z.number().int(),
    createdAt: z.date(),
  })),
  onsiteSupport: z.array(z.object({
    type: z.string(),
    scheduledAt: z.date(),
    scheduledEnd: z.date().nullable(),
    roomInfo: z.string().nullable(),
    status: z.string(),
  })),
});

const publicTicketResponseSchema = z.object({
  success: z.literal(true),
  data: publicTicketSchema,
});

const publicAttachmentResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    id: z.string(),
    fileName: z.string(),
    fileSize: z.number().int(),
    createdAt: z.date(),
  }),
});

const trackResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({ accessToken: z.string() }),
});

export const publicRoutes: FastifyPluginAsync = async (app) => {
  // Public: View ticket by access token
  app.get('/ticket/:accessToken', {
    schema: {
      tags: ['Public Tickets'],
      summary: 'Erişim anahtarıyla destek talebini getirir',
      params: accessTokenParamsSchema,
      response: { 200: publicTicketResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const { accessToken } = request.params as { accessToken: string };

    const ticket = await app.prisma.ticket.findUnique({
      where: { accessToken },
      select: {
        id: true,
        ticketNumber: true,
        subject: true,
        description: true,
        priority: true,
        status: true,
        accessTokenExpiresAt: true,
        createdAt: true,
        updatedAt: true,
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
        // İç not kayıtları public geçmişte GÖSTERİLMEZ. Yukarıdaki
        // `notes: { where: { isInternal: false } }` filtresi tek başına yetmez:
        // her not için history'ye de bir satır yazılır ve bu ilişki
        // filtrelenmezse iç notların varlığı (ve eskiden metni) sızar.
        //
        // İkinci savunma katmanı notes.routes.ts'tedir: iç notların metni artık
        // history'ye hiç yazılmıyor.
        history: {
          where: { action: { not: 'internal_note_added' } },
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
          select: { id: true, fileName: true, fileSize: true, createdAt: true },
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

    // Süresi dolmuş link 404 döner — "bulunamadı" ile "süresi doldu" ayrımı
    // yapılmaz, aksi halde geçerli bir ticket numarasının varlığı doğrulanır.
    if (!ticket || isAccessExpired(ticket.accessTokenExpiresAt)) {
      return reply.status(404).send({ success: false, error: 'Ticket bulunamadı' });
    }

    const { accessTokenExpiresAt: _accessTokenExpiresAt, ...publicTicket } = ticket;
    reply.send({ success: true, data: publicTicket });
  });

  // Public: Reply to ticket — with IT notification
  app.post('/ticket/:accessToken/reply', {
    schema: {
      tags: ['Public Tickets'],
      summary: 'Destek talebine kullanıcı yanıtı ekler',
      params: accessTokenParamsSchema,
      body: publicReplySchema,
      response: { 200: successResponseSchema, ...commonErrorResponses },
    },
    config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    const { accessToken } = request.params as { accessToken: string };
    // Kimliksiz uç — kırpma ve üst sınır zorunlu.
    const body = publicReplySchema.parse(request.body);

    const ticket = await app.prisma.ticket.findUnique({
      where: { accessToken },
      select: {
        id: true,
        ticketNumber: true,
        companyId: true,
        createdByEmail: true,
        assignedToId: true,
        status: true,
        accessTokenExpiresAt: true,
        assignedTo: { select: { email: true, fullName: true } },
      },
    });

    if (!ticket || isAccessExpired(ticket.accessTokenExpiresAt)) {
      return reply.status(404).send({ success: false, error: 'Ticket bulunamadı' });
    }

    // Create history + update status atomically
    const wasWaiting = ticket.status === 'waiting_user_response';
    await app.prisma.$transaction(async (tx) => {
      await tx.ticketHistory.create({
        data: {
          ticketId: ticket.id,
          action: 'user_reply',
          newValue: body.content,
          createdByEmail: ticket.createdByEmail,
        },
      });

      if (wasWaiting) {
        await tx.ticket.update({
          where: { id: ticket.id },
          data: { status: 'open' },
        });
      }
    });

    // SSE broadcast to staff
    broadcastToStaff('user_reply', {
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      email: ticket.createdByEmail,
      content: body.content.substring(0, 100),
    }, ticket.companyId);

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
    schema: {
      tags: ['Public Tickets'],
      summary: 'Destek talebine kullanıcı dosyası ekler',
      params: accessTokenParamsSchema,
      response: { 201: publicAttachmentResponseSchema, ...commonErrorResponses },
    },
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { accessToken } = request.params as { accessToken: string };

    const ticket = await app.prisma.ticket.findUnique({
      where: { accessToken },
      select: { id: true, createdByEmail: true, status: true, accessTokenExpiresAt: true },
    });

    if (!ticket || isAccessExpired(ticket.accessTokenExpiresAt)) {
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
    const saved = await saveFile(buffer, file.filename, ticket.id, file.mimetype);

    const attachment = await app.prisma.attachment.create({
      data: {
        ticketId: ticket.id,
        fileName: saved.fileName,
        filePath: saved.filePath,
        fileSize: saved.fileSize,
        mimeType: file.mimetype,
        uploadedBy: ticket.createdByEmail,
      },
      select: { id: true, fileName: true, fileSize: true, createdAt: true },
    });

    reply.status(201).send({ success: true, data: attachment });
  });

  // Public: Track single ticket by ticketNumber + email
  app.post('/track', {
    schema: {
      tags: ['Public Tickets'],
      summary: 'Talep numarası ve e-postayla erişim anahtarını getirir',
      body: ticketTrackSchema,
      response: { 200: trackResponseSchema, ...commonErrorResponses },
    },
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
  }, async (request, reply) => {
    const parsed = ticketTrackSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(404).send({ success: false, error: 'Talep bulunamadı veya email eşleşmiyor' });
    }

    const ticket = await app.prisma.ticket.findFirst({
      where: {
        ticketNumber: parsed.data.ticketNumber,
        createdByEmail: { equals: parsed.data.email, mode: 'insensitive' },
      },
      select: { id: true, accessToken: true, accessTokenExpiresAt: true },
    });

    if (!ticket) {
      return reply.status(404).send({ success: false, error: 'Talep bulunamadı veya email eşleşmiyor' });
    }

    // Süresi dolmuş linki YENİLE. Çağıran ticket numarasını VE e-postayı bildiğini
    // kanıtladı; kapalı bir talebi tekrar görüntülemesi meşru. Yenileme olmasa
    // süresi dolan link kalıcı olarak ölür ve kullanıcı sonucunu göremezdi.
    if (isAccessExpired(ticket.accessTokenExpiresAt)) {
      await app.prisma.ticket.update({
        where: { id: ticket.id },
        data: { accessTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      });
    }

    reply.send({ success: true, data: { accessToken: ticket.accessToken } });
  });
};
