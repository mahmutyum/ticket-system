import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { broadcastToStaff } from '../../services/sse.service.js';
import { queueEmail } from '../../jobs/queue.js';
import { saveFile, isAllowedMimeType } from '../../services/storage.service.js';
import { requiredText, emailSchema, LIMITS } from '../../utils/validation.js';

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

    // Süresi dolmuş link 404 döner — "bulunamadı" ile "süresi doldu" ayrımı
    // yapılmaz, aksi halde geçerli bir ticket numarasının varlığı doğrulanır.
    if (!ticket || isAccessExpired(ticket.accessTokenExpiresAt)) {
      return reply.status(404).send({ success: false, error: 'Ticket bulunamadı' });
    }

    reply.send({ success: true, data: ticket });
  });

  // Public: Reply to ticket — with IT notification
  app.post('/ticket/:accessToken/reply', {
    config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    const { accessToken } = request.params as { accessToken: string };
    // Kimliksiz uç — kırpma ve üst sınır zorunlu.
    const body = z.object({
      content: requiredText({ ...LIMITS.noteContent, label: 'Yanıt' }),
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
    });

    reply.status(201).send({ success: true, data: attachment });
  });

  // Public: Track single ticket by ticketNumber + email
  app.post('/track', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
  }, async (request, reply) => {
    const parsed = z.object({
      ticketNumber: z.string().trim().min(1).max(50),
      email: emailSchema,
    }).safeParse(request.body);

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
