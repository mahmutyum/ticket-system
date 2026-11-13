import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { redisConnection, queueEmail } from '../../jobs/queue.js';
import { config } from '../../config/index.js';
import { commonErrorResponses, successResponseSchema } from '../../utils/api-schema.js';
import { t } from '../../i18n/index.js';

/**
 * "Taleplerim" (v1.3) — talep sahibinin e-posta sahipliği doğrulamalı, birleşik
 * talep listesi. Parola yok: kullanıcı e-postasını girer, kısa ömürlü token ile
 * o adrese ait tüm taleplerini tek listede görür.
 *
 * Güvenlik modeli:
 * - Token nanoid (tahmin edilemez), Redis'te 15 dakika yaşar, yalnızca ilgili
 *   e-postaya gönderilir — "link kendisi paroladır" ilkesi access link ile aynı.
 * - POST yanıtında "böyle bir e-posta var mı" bilgisi SIZMAZ: bilinen/bilinmeyen
 *   tüm adreslere aynı genel yanıt döner ve her durumda mail kuyruğa girer
 *   (listesi boş mail gelir). Bu yüzden adres taraması yapılamaz.
 * - Liste yanıtında her talebin `accessToken`'ı yer alır: talep sahibi zaten o
 *   linklerin alıcısıdır (erişim link e-postalarıyla eşdeğer bir sızıntı yüzeyi).
 * - Hız limitleri: link isteği 5/10dk, liste 20/10dk.
 */

const KEY_PREFIX = 'my-tickets:';
const TOKEN_TTL_SECONDS = 900;

const linkBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  /** Public istemcinin arayüz dili — mail bu dilde gider (varsayılan tr). */
  locale: z.enum(['tr', 'en']).default('tr'),
});

const listViewSchema = z.object({
  id: z.string(),
  ticketNumber: z.string(),
  subject: z.string(),
  status: z.string(),
  priority: z.string(),
  createdAt: z.date(),
  accessToken: z.string(),
  company: z.object({ name: z.string() }),
});

export const myTicketsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/link', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
    schema: {
      tags: ['Public'],
      summary: 'Taleplerim bağlantısını e-posta ile gönderir',
      body: linkBody,
      response: { 200: successResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const { email, locale } = request.body;
    const token = nanoid(24);
    await redisConnection.set(KEY_PREFIX + token, JSON.stringify({ email, locale }), 'EX', TOKEN_TTL_SECONDS);

    // E-postadaki sayaç için talep sayısı okunur; adres bilinmeyen bile olsa
    // mail gider ("talep bulunamadı" içerikli) — enumeration sızıntısı yok.
    const ticketCount = await app.prisma.ticket.count({ where: { createdByEmail: email } });
    const myTicketsUrl = `${config.CANONICAL_URL}/my?token=${token}`;
    await queueEmail({
      to: email,
      locale,
      templateSlug: 'my_tickets_link',
      variables: { myTicketsUrl, ticketCount: String(ticketCount) },
    });
    reply.send({ success: true });
  });

  app.get('/:token', {
    config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
    schema: {
      tags: ['Public'],
      summary: 'Token ile talep listesini döner',
      params: z.object({ token: z.string().min(10).max(64) }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({ email: z.string(), tickets: z.array(listViewSchema) }),
        }),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    const raw = await redisConnection.get(KEY_PREFIX + request.params.token);
    if (!raw) {
      return reply.status(404).send({ success: false, error: t(request, 'my_tickets.expired') });
    }
    const { email } = JSON.parse(raw) as { email: string };
    const tickets = await app.prisma.ticket.findMany({
      where: { createdByEmail: email },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, ticketNumber: true, subject: true, status: true, priority: true,
        createdAt: true, accessToken: true, company: { select: { name: true } },
      },
    });
    reply.send({ success: true, data: { email, tickets } });
  });
};
