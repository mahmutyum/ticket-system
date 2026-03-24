import { FastifyPluginAsync } from 'fastify';
import jwt from 'jsonwebtoken';
import { addClient, getClientCount } from '../../services/sse.service.js';
import { config } from '../../config/index.js';
import type { JwtPayload } from '../../plugins/auth.js';

export const eventRoutes: FastifyPluginAsync = async (app) => {
  // SSE: Staff live updates
  // EventSource can't send custom headers, so we use query param token
  app.get('/staff', async (request, reply) => {
    const { token } = request.query as { token?: string };

    if (!token) {
      return reply.status(401).send({ success: false, error: 'Token gerekli' });
    }

    try {
      const payload = jwt.verify(token, config.JWT_SECRET) as JwtPayload;

      // Verify staff is active
      const staff = await app.prisma.staff.findUnique({
        where: { id: payload.id },
        select: { id: true, isActive: true },
      });

      if (!staff || !staff.isActive) {
        return reply.status(401).send({ success: false, error: 'Geçersiz oturum' });
      }
    } catch {
      return reply.status(401).send({ success: false, error: 'Geçersiz token' });
    }

    const clientId = addClient(reply, 'staff');
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
      select: { id: true },
    });

    if (!ticket) {
      return reply.status(404).send({ success: false, error: 'Ticket bulunamadı' });
    }

    const clientId = addClient(reply, 'public', accessToken);
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
