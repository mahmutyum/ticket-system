import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from 'jsonwebtoken';
import type { StaffRole } from '@prisma/client';
import { authPlugin } from '../../src/plugins/auth.js';
import { config } from '../../src/config/index.js';

/**
 * Route seviyesinde yetkilendirme testleri için minimal uygulama.
 *
 * Gerçek `buildApp()` Postgres ve Redis'e bağlanır; buradaki amaç veri erişimini
 * değil YETKİ KARARLARINI doğrulamak, bu yüzden `app.prisma` sahte bir nesneyle
 * decorate edilir. Auth plugin'i ve route modülleri GERÇEKTİR — testin değeri
 * burada: `requireRole` ve handler içindeki kapsam kontrolleri gerçekten çalışır.
 */
export function buildTestApp(prismaStub: any, redisStub: any = {}): FastifyInstance {
  const app = Fastify();
  app.register(cookie, { secret: config.JWT_SECRET });
  app.decorate('prisma', prismaStub);
  app.decorate('redis', redisStub);
  app.register(authPlugin);
  return app;
}

/** Verilen rol için geçerli bir access token üretir. */
export function tokenFor(role: StaffRole, id = 'staff-1', email = `${role}@test.local`): string {
  return jwt.sign({ id, email, role }, config.JWT_SECRET, { expiresIn: '15m' });
}

/** `Authorization: Bearer` başlığı. */
export function authHeader(role: StaffRole, id?: string) {
  return { authorization: `Bearer ${tokenFor(role, id)}` };
}

/**
 * `staffCompany.findMany`'yi taklit eder — `getStaffCompanyScope` bunu okur.
 * Boş dizi = hiçbir şirkete atanmamış (fail-closed).
 */
export function scopeStub(companyIds: string[]) {
  return {
    findMany: async () => companyIds.map((companyId) => ({ companyId })),
  };
}
