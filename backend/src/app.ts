import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { join } from 'path';
import { config } from './config/index.js';
import { prismaPlugin } from './plugins/prisma.js';
import { redisPlugin } from './plugins/redis.js';
import { authPlugin } from './plugins/auth.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { companyRoutes } from './modules/companies/companies.routes.js';
import { locationRoutes } from './modules/locations/locations.routes.js';
import { categoryRoutes } from './modules/categories/categories.routes.js';
import { customFieldRoutes } from './modules/custom-fields/custom-fields.routes.js';
import { ticketRoutes } from './modules/tickets/tickets.routes.js';
import { noteRoutes } from './modules/notes/notes.routes.js';
import { staffRoutes } from './modules/staff/staff.routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';
import { publicRoutes } from './modules/tickets/public.routes.js';
import { onsiteRoutes } from './modules/onsite-support/onsite.routes.js';
import { eventRoutes } from './modules/events/events.routes.js';
import { notificationRoutes } from './modules/notifications/notifications.routes.js';
import { templateRoutes } from './modules/templates/templates.routes.js';
import { reportRoutes } from './modules/reports/reports.routes.js';

export async function buildApp() {
  const app = Fastify({
    // NPM/Coolify reverse proxy arkasında: X-Forwarded-For/Proto/Host
    // header'larına güven. Rate-limit ve audit log gerçek client IP'yi alsın.
    trustProxy: true,
    logger: {
      level: config.NODE_ENV === 'production' ? 'info' : 'debug',
      transport: config.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  });

  // Core plugins
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    // Stricter limits set per-route where needed
  });

  await app.register(cors, {
    origin: config.NODE_ENV === 'development'
      ? [
          'http://localhost:1111',
          'http://localhost:3000',
          'http://localhost:4000',
          ...config.APP_ORIGINS,
        ]
      : config.APP_ORIGINS,
    credentials: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(cookie, {
    secret: config.JWT_SECRET,
  });

  await app.register(multipart, {
    limits: {
      fileSize: config.MAX_FILE_SIZE,
    },
  });

  // Custom plugins
  await app.register(prismaPlugin);
  await app.register(redisPlugin);
  await app.register(authPlugin);

  // Static file serving (uploads)
  await app.register(fastifyStatic, {
    root: config.UPLOAD_DIR,
    prefix: '/uploads/',
    decorateReply: false,
  });

  // Health check
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // API Routes
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(companyRoutes, { prefix: '/companies' });
  await app.register(locationRoutes, { prefix: '/locations' });
  await app.register(categoryRoutes, { prefix: '/categories' });
  await app.register(customFieldRoutes, { prefix: '/custom-fields' });
  await app.register(ticketRoutes, { prefix: '/tickets' });
  await app.register(noteRoutes, { prefix: '/tickets' });
  await app.register(staffRoutes, { prefix: '/staff' });
  await app.register(dashboardRoutes, { prefix: '/dashboard' });
  await app.register(publicRoutes, { prefix: '/public' });
  await app.register(onsiteRoutes, { prefix: '/onsite-support' });
  await app.register(notificationRoutes, { prefix: '/notifications' });
  await app.register(eventRoutes, { prefix: '/events' });
  await app.register(templateRoutes, { prefix: '/templates' });
  await app.register(reportRoutes, { prefix: '/reports' });

  // Global error handler
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode || 500;
    const message = statusCode === 500 ? 'Sunucu hatası' : error.message;

    if (statusCode === 500) {
      app.log.error(error);
    }

    reply.status(statusCode).send({
      success: false,
      error: message,
      ...(config.NODE_ENV === 'development' && { stack: error.stack }),
    });
  });

  return app;
}
