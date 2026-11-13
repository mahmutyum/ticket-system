import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { getStaffCompanyScope, isCompanyInScope } from './staff-scope.js';

/**
 * Route handler'larında tekrarlanan kapsam boilerplate'i için tek nokta.
 *
 * Modüllerde aynı desen satır satır tekrarlanıyordu: `getStaffCompanyScope`
 * çağır → `isCompanyInScope` ile denetle → kapsam dışıysa 403 gönder. Ayrıca
 * bazı handler'lar aynı istekte scope'u birden çok kez sorguluyordu (örn. KB
 * `canWrite` hem eski hem yeni companyId için) — burada istek başına tek
 * sorgu atılıp önbelleklenir.
 *
 * Kullanım (route handler içinde):
 *
 *   const scope = companyScopeChecker(app.prisma, request);
 *   if (!(await scope.inScope(reply, companyId, t(request, 'assets.forbidden')))) return;
 *   // kapsam dizisi gerektiren yerlerde (null = admin — tüm şirketler):
 *   const companyIds = await scope.of();
 *
 * NOT: `resolveCompanyFilter` kullanan ticket benzeri listeler bu helper'a
 * uygun değildir — onlar filtre kesiştirmesi yapar (boolean gate değil) ve
 * güvenlik açısından olduğu gibi bırakılmalıdır.
 */
export function companyScopeChecker(prisma: PrismaClient, request: FastifyRequest) {
  let cached: Promise<string[] | null> | undefined;
  const of = () => {
    cached ??= getStaffCompanyScope(prisma, request.staffUser!.id, request.staffUser!.role);
    return cached;
  };
  return {
    of,
    /** Kapsam dışıysa 403 gönderir ve false döner; handler `return` eder. */
    async inScope(reply: FastifyReply, companyId: string, forbiddenMessage: string): Promise<boolean> {
      if (isCompanyInScope(await of(), companyId)) return true;
      reply.status(403).send({ success: false, error: forbiddenMessage });
      return false;
    },
  };
}
