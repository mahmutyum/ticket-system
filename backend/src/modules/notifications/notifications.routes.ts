import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { NotificationType, NotificationStatus } from '@prisma/client';
import { queueEmail, queueSms } from '../../jobs/queue.js';

const notificationFilterSchema = z.object({
  status: z.nativeEnum(NotificationStatus).optional(),
  type: z.nativeEnum(NotificationType).optional(),
  ticketId: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
});
const idParamsSchema = z.object({ id: z.string().min(1).max(128) });

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  // List notifications with proper filtering and pagination
  app.get('/', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: { querystring: notificationFilterSchema, tags: ['Notifications'], summary: 'Bildirimleri filtreleyerek listele' },
  }, async (request, reply) => {
    const query = notificationFilterSchema.parse(request.query);

    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.ticketId) where.ticketId = query.ticketId;

    const [notifications, total] = await Promise.all([
      app.prisma.notification.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          ticket: { select: { ticketNumber: true } },
        },
      }),
      app.prisma.notification.count({ where }),
    ]);

    reply.send({
      success: true,
      data: notifications,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    });
  });

  // Retry failed notification — actually re-queue the job
  app.post('/:id/retry', {
    preValidation: [app.requireRole('admin')],
    schema: { params: idParamsSchema, tags: ['Notifications'], summary: 'Başarısız bildirimi yeniden kuyruğa al' },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const notification = await app.prisma.notification.findUnique({
      where: { id },
      include: { ticket: { select: { ticketNumber: true } } },
    });

    if (!notification) {
      return reply.status(404).send({ success: false, error: 'Bildirim bulunamadı' });
    }

    if (notification.status !== 'failed') {
      return reply.status(400).send({ success: false, error: 'Sadece başarısız bildirimler tekrar denenebilir' });
    }

    // Reset status
    await app.prisma.notification.update({
      where: { id },
      data: { status: 'pending', errorMsg: null },
    });

    // Re-queue based on type
    if (notification.type === 'email') {
      await queueEmail({
        to: notification.recipient,
        templateSlug: notification.channel,
        variables: {}, // Original variables not stored, use template defaults
        ticketId: notification.ticketId || undefined,
      });
    } else if (notification.type === 'sms') {
      await queueSms({
        to: notification.recipient,
        templateSlug: notification.channel,
        variables: {},
        ticketId: notification.ticketId || undefined,
      });
    }

    reply.send({ success: true, message: 'Bildirim tekrar kuyruğa eklendi' });
  });

  // Notification stats
  app.get('/stats', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: { tags: ['Notifications'], summary: 'Bildirim istatistiklerini getir' },
  }, async (request, reply) => {
    const [pending, sent, failed] = await Promise.all([
      app.prisma.notification.count({ where: { status: 'pending' } }),
      app.prisma.notification.count({ where: { status: 'sent' } }),
      app.prisma.notification.count({ where: { status: 'failed' } }),
    ]);

    reply.send({
      success: true,
      data: { pending, sent, failed, total: pending + sent + failed },
    });
  });
};
