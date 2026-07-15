import { FastifyPluginAsync } from 'fastify';
import { nanoid } from 'nanoid';
import { addClient, getClientCount } from '../../services/sse.service.js';
import { getStaffCompanyScope } from '../../utils/staff-scope.js';

/**
 * SSE bileti — kısa ömürlü, TEK KULLANIMLIK.
 *
 * Tarayıcının `EventSource` API'si özel header gönderemez, bu yüzden staff akışı
 * kimliği URL'den almak zorunda. Önceden URL'e doğrudan JWT konuyordu ve o token
 * 15 dakika geçerliydi: nginx `access_log` `$request`'i (yani tam yolu) kaydettiği
 * için her SSE bağlantısı 15 dakikalık bir oturumu düz metin olarak log'a yazıyordu.
 *
 * Artık istemci önce Authorization header'ıyla bir BİLET alır; bilet Redis'te
 * 30 saniye yaşar ve okunduğu anda silinir. Log'a düşen değer, kullanıldığı anda
 * ölmüş tek kullanımlık bir dizedir.
 */
const TICKET_TTL_SECONDS = 30;
const sseTicketKey = (ticket: string) => `sse:ticket:${ticket}`;

export const eventRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Bilet üret — Authorization header'ı ile (normal auth).
   *
   * Bilet YALNIZCA bir SSE bağlantısı açmaya yarar; başka hiçbir uçta geçerli
   * değildir ve tek kullanımlıktır.
   */
  app.post('/ticket-grant', { preHandler: [app.authenticate] }, async (request, reply) => {
    const staffUser = request.staffUser!;
    const ticket = nanoid(32);
    await app.redis.set(sseTicketKey(ticket), staffUser.id, 'EX', TICKET_TTL_SECONDS);
    reply.send({ success: true, data: { ticket, expiresIn: TICKET_TTL_SECONDS } });
  });

  // SSE: Staff live updates
  app.get('/staff', async (request, reply) => {
    const { ticket } = request.query as { ticket?: string };

    if (!ticket) {
      return reply.status(401).send({ success: false, error: 'Bilet gerekli' });
    }

    // TEK KULLANIMLIK: oku ve hemen sil. Log'a düşen bilet tekrar kullanılamaz.
    const staffId = await app.redis.get(sseTicketKey(ticket));
    await app.redis.del(sseTicketKey(ticket));

    if (!staffId) {
      return reply.status(401).send({ success: false, error: 'Bilet geçersiz veya süresi dolmuş' });
    }

    // Rol ve aktiflik DB'den okunur — bilet yalnızca "kim" bilgisini taşır.
    const staff = await app.prisma.staff.findUnique({
      where: { id: staffId },
      select: { id: true, isActive: true, role: true },
    });

    if (!staff || !staff.isActive) {
      return reply.status(401).send({ success: false, error: 'Geçersiz oturum' });
    }

    // Şirket kapsamı bağlantı anında çözülür ve keep-alive turunda tazelenir.
    // Bu olmadan broadcastToStaff kime ne göndereceğini bilemez ve REST
    // katmanındaki kapsam denetimi bu kanalda tamamen baypas edilir.
    const resolveScope = () => getStaffCompanyScope(app.prisma, staff.id, staff.role);
    const companyScope = await resolveScope();

    const clientId = addClient(reply, 'staff', {
      staff: { staffId: staff.id, companyScope, resolveScope },
    });
    app.log.info(`SSE staff client connected: ${clientId}`);

    request.raw.on('close', () => {
      app.log.info(`SSE staff client disconnected: ${clientId}`);
    });

    return reply;
  });

  // SSE: Public ticket live updates
  app.get('/ticket/:accessToken', async (request, reply) => {
    const { accessToken } = request.params as { accessToken: string };

    const ticket = await app.prisma.ticket.findUnique({
      where: { accessToken },
      select: { id: true, accessTokenExpiresAt: true },
    });

    if (!ticket || (ticket.accessTokenExpiresAt && ticket.accessTokenExpiresAt < new Date())) {
      return reply.status(404).send({ success: false, error: 'Ticket bulunamadı' });
    }

    const clientId = addClient(reply, 'public', { ticketAccessToken: accessToken });
    app.log.info(`SSE public client connected: ${clientId} for ticket ${accessToken.substring(0, 8)}...`);

    return reply;
  });

  // SSE stats
  app.get('/stats', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    reply.send({ success: true, data: getClientCount() });
  });
};
