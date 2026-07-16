import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Prisma, NotificationType, NotificationStatus } from '@prisma/client';
import { queueEmail, queueSms } from '../../jobs/queue.js';
import { getStaffCompanyScope } from '../../utils/staff-scope.js';
import { commonErrorResponses } from '../../utils/api-schema.js';

const notificationFilterSchema = z.object({
  status: z.nativeEnum(NotificationStatus).optional(),
  type: z.nativeEnum(NotificationType).optional(),
  ticketId: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
});
const idParamsSchema = z.object({ id: z.string().min(1).max(128) });
const notificationSchema = z.object({
  id: z.string(),
  ticketId: z.string().nullable(),
  type: z.nativeEnum(NotificationType),
  channel: z.string(),
  recipient: z.string(),
  subject: z.string().nullable(),
  body: z.string(),
  status: z.nativeEnum(NotificationStatus),
  errorMsg: z.string().nullable(),
  sentAt: z.date().nullable(),
  createdAt: z.date(),
  ticket: z.object({ ticketNumber: z.string() }).nullable(),
});
const messageResponseSchema = z.object({ success: z.literal(true), message: z.string() });
const statsSchema = z.object({
  pending: z.number().int().nonnegative(),
  sent: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export const notificationRoutes: FastifyPluginAsyncZod = async (app) => {
  // List notifications with proper filtering and pagination
  app.get('/', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: {
      querystring: notificationFilterSchema,
      tags: ['Notifications'],
      summary: 'Bildirimleri filtreleyerek listele',
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.array(notificationSchema),
          pagination: z.object({
            page: z.number().int(), limit: z.number().int(), total: z.number().int(), totalPages: z.number().int(),
          }),
        }),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    const query = request.query;

    const staffUser = request.staffUser!;
    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    const where: Prisma.NotificationWhereInput = scope === null
      ? {}
      : { ticket: { companyId: { in: scope } } };
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
    schema: {
      params: idParamsSchema,
      tags: ['Notifications'],
      summary: 'Başarısız bildirimi yeniden kuyruğa al',
      response: { 200: messageResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const { id } = request.params;

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
    schema: {
      tags: ['Notifications'],
      summary: 'Bildirim istatistiklerini getir',
      response: {
        200: z.object({ success: z.literal(true), data: statsSchema }),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    const staffUser = request.staffUser!;
    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    const scopeWhere: Prisma.NotificationWhereInput = scope === null
      ? {}
      : { ticket: { companyId: { in: scope } } };
    const [pending, sent, failed] = await Promise.all([
      app.prisma.notification.count({ where: { ...scopeWhere, status: 'pending' } }),
      app.prisma.notification.count({ where: { ...scopeWhere, status: 'sent' } }),
      app.prisma.notification.count({ where: { ...scopeWhere, status: 'failed' } }),
    ]);

    reply.send({
      success: true,
      data: { pending, sent, failed, total: pending + sent + failed },
    });
  });
};
