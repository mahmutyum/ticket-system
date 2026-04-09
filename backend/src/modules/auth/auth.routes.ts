import { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcrypt';
import { staffLoginSchema, emailLookupSchema, refreshTokenSchema } from './auth.schema.js';
import { generateTokens, verifyRefreshToken } from '../../plugins/auth.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  // Staff login
  app.post('/staff/login', {
    config: {
      rateLimit: { max: 5, timeWindow: '1 minute' },
    },
  }, async (request, reply) => {
    const body = staffLoginSchema.parse(request.body);

    const staff = await app.prisma.staff.findUnique({
      where: { email: body.email },
    });

    if (!staff || !staff.isActive) {
      return reply.status(401).send({ success: false, error: 'Geçersiz email veya şifre' });
    }

    const validPassword = await bcrypt.compare(body.password, staff.passwordHash);
    if (!validPassword) {
      return reply.status(401).send({ success: false, error: 'Geçersiz email veya şifre' });
    }

    const payload = { id: staff.id, email: staff.email, role: staff.role };
    const tokens = generateTokens(payload);

    // Store refresh token in Redis
    await app.redis.set(`refresh:${staff.id}`, tokens.refreshToken, 'EX', 7 * 24 * 60 * 60);

    reply
      .setCookie('refresh_token', tokens.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/auth/staff/refresh',
        maxAge: 7 * 24 * 60 * 60,
      })
      .send({
        success: true,
        data: {
          accessToken: tokens.accessToken,
          user: {
            id: staff.id,
            email: staff.email,
            fullName: staff.fullName,
            role: staff.role,
            department: staff.department,
            avatarUrl: staff.avatarUrl,
          },
        },
      });
  });

  // Refresh token
  app.post('/staff/refresh', async (request, reply) => {
    const bodyToken = refreshTokenSchema.safeParse(request.body);
    const token = request.cookies?.refresh_token ||
      (bodyToken.success ? bodyToken.data.refreshToken : undefined);

    if (!token) {
      return reply.status(401).send({ success: false, error: 'Refresh token gerekli' });
    }

    try {
      const payload = verifyRefreshToken(token);

      // Verify token exists in Redis
      const storedToken = await app.redis.get(`refresh:${payload.id}`);
      if (storedToken !== token) {
        return reply.status(401).send({ success: false, error: 'Geçersiz refresh token' });
      }

      const staff = await app.prisma.staff.findUnique({
        where: { id: payload.id },
      });

      if (!staff || !staff.isActive) {
        return reply.status(401).send({ success: false, error: 'Hesap aktif değil' });
      }

      const newPayload = { id: staff.id, email: staff.email, role: staff.role };
      const tokens = generateTokens(newPayload);

      await app.redis.set(`refresh:${staff.id}`, tokens.refreshToken, 'EX', 7 * 24 * 60 * 60);

      reply
        .setCookie('refresh_token', tokens.refreshToken, {
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          path: '/auth/staff/refresh',
          maxAge: 7 * 24 * 60 * 60,
        })
        .send({
          success: true,
          data: { accessToken: tokens.accessToken },
        });
    } catch {
      return reply.status(401).send({ success: false, error: 'Geçersiz refresh token' });
    }
  });

  // Staff logout
  app.post('/staff/logout', { preHandler: [app.authenticate] }, async (request, reply) => {
    await app.redis.del(`refresh:${request.staffUser!.id}`);
    reply
      .clearCookie('refresh_token', { path: '/auth/staff/refresh' })
      .send({ success: true });
  });

  // Email lookup for public users
  app.post('/lookup', async (request, reply) => {
    const body = emailLookupSchema.parse(request.body);

    const user = await app.prisma.user.findUnique({
      where: { email: body.email },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        companyId: true,
        locationId: true,
        department: true,
        extraInfo: true,
      },
    });

    reply.send({
      success: true,
      data: user, // null if not found
    });
  });
};
