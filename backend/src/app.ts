import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
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
import { taskRoutes } from './modules/tasks/tasks.routes.js';
import { credentialRoutes } from './modules/credentials/credentials.routes.js';
import { attachmentRoutes, brandingRoutes } from './modules/attachments/attachments.routes.js';

export async function buildApp() {
  const app = Fastify({
    // Reverse proxy arkasında X-Forwarded-* header'larına güvenilir — AMA
    // sınırlı sayıda hop için. `true` olsaydı zincirin tamamına güvenilir ve
    // request.ip istemcinin uydurduğu değeri alırdı; rate limiting'in tamamı
    // (login 5/dk dahil) tek bir başlıkla baypas edilirdi.
    // Değeri TRUST_PROXY belirler — gerekçe ve doğru değer config/index.ts'te.
    trustProxy: config.TRUST_PROXY,
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

  // Backend'in CSP'si YALNIZCA kendi yanıtlarını etkiler (/api/*, /attachments, /docs).
  // SPA'yı frontend container'ındaki nginx servis eder — kullanıcı arayüzünün asıl
  // CSP'si orada tanımlıdır (frontend/nginx.conf).
  //
  // Buradaki politika Swagger UI'ın çalışabileceği en sıkı hâldir: swagger-ui
  // kendi başlatma script'ini ve stillerini satır içi enjekte eder, bu yüzden
  // 'unsafe-inline' zorunludur. JSON API yanıtları için CSP zaten işlevsizdir;
  // asıl kazanç aşağıda /uploads'a uygulanan çok daha sıkı politikadır.
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        baseUri: ["'self'"],
      },
    },
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

  // NOT: /uploads ARTIK STATİK SERVİS EDİLMİYOR.
  //
  // @fastify/static ile servis edilirken ekler KİMLİKSİZ erişilebiliyordu: API
  // şirket kapsamını doğru uyguluyor ama dosyanın kendisi için hiçbir kontrol
  // yoktu. Yol tahmin edilemezdi, o kadar — yani yetkilendirme değil, "URL'i bilen
  // girer". O URL ise nginx access_log'una, tarayıcı geçmişine ve e-postalara
  // düşüyor, ticket kapandıktan sonra bile çalışıyordu.
  //
  // Ekler /attachments/:id (kapsam veya geçerli accessToken kontrollü),
  // logolar /branding/:companyId/:file (public, inline) üzerinden gider.
  // Bkz. modules/attachments/attachments.routes.ts

  // API dokümantasyonu — /docs
  //
  // NOT: Route'lar fastify'ın `schema:` alanını kullanmaz; input validation
  // handler içinde Zod ile yapılır (`schema.parse(request.body)`). Bu yüzden
  // Swagger request/response gövdelerini gösteremez — sadece endpoint listesi
  // (method + path) üretir. Gövde formatları için ilgili modülün Zod şemasına bak.
  if (config.ENABLE_API_DOCS) {
    await app.register(swagger, {
      openapi: {
        info: {
          title: 'IT Ticket System API',
          description:
            'Endpoint listesi. Frontend bu API\'ye /api/* öneki ile erişir (nginx rewrite eder); ' +
            'buradaki yollar backend\'in gördüğü ham yollardır.',
          version: '1.0.0',
        },
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          },
        },
      },
    });
    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: { docExpansion: 'list', deepLinking: true },
    });
  }

  // Health check
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Global error handler
  //
  // SIRA ÖNEMLİ: bu blok route kayıtlarından ÖNCE gelmelidir. `await
  // app.register(...)` çağrıldığı anda child context'i oluşturur ve o an geçerli
  // olan hata handler'ını yakalar. Route'lardan sonra çağrılırsa hiçbirine
  // uygulanmaz — Fastify'ın varsayılan handler'ı devrede kalır ve buradaki
  // Türkçe mesajlar, 500 gizleme, 400 eşlemesi hiç çalışmaz. (Bu dosyada
  // uzun süre böyleydi: yanıtlar {statusCode, error, message} formatında
  // dönüyordu, {success, error} değil.)
  //
  // ZodError ve PrismaClientValidationError'ın `statusCode`'u YOKTUR. Sadece
  // `error.statusCode || 500` bakıldığında bunlar 500 "Sunucu hatası" oluyor ve
  // her biri error log'a yazılıyordu. Sonuç: `?dateFrom=abc` gibi sıradan bir
  // istemci hatası, kimliksiz bir kullanıcının tetikleyebildiği 500'e ve log
  // gürültüsüne dönüşüyordu; gerçek sunucu arızaları da bunların arasında
  // kayboluyordu.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    // Girdi doğrulama hataları → 400.
    if (error instanceof ZodError) {
      return reply.status(400).send({
        success: false,
        error: 'Geçersiz istek',
        // Alan bazlı ayrıntı yalnızca geliştirmede — production'da şema yapısını
        // dışarı vermez.
        ...(config.NODE_ENV === 'development' && { details: error.flatten() }),
      });
    }

    // Prisma'ya geçersiz bir değer/alan ulaştıysa bu da bir istemci hatasıdır
    // (ör. tarih olarak ayrıştırılamayan bir query parametresi).
    if (
      error instanceof Prisma.PrismaClientValidationError ||
      error instanceof Prisma.PrismaClientKnownRequestError
    ) {
      app.log.warn({ err: error }, 'Prisma reddetti — geçersiz istek');
      return reply.status(400).send({ success: false, error: 'Geçersiz istek' });
    }

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
  await app.register(taskRoutes, { prefix: '/tasks' });
  await app.register(credentialRoutes, { prefix: '/credentials' });
  await app.register(attachmentRoutes, { prefix: '/attachments' });
  await app.register(brandingRoutes, { prefix: '/branding' });


  return app;
}
