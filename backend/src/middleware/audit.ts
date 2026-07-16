import { prisma } from '../db.js';
import { Prisma } from '@prisma/client';

export async function createAuditLog(params: {
  entityType: string;
  entityId: string;
  action: string;
  changes?: Record<string, unknown>;
  performedBy: string;
  ipAddress?: string;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        changes: (params.changes || {}) as Prisma.InputJsonObject,
        performedBy: params.performedBy,
        ipAddress: params.ipAddress,
      },
    });
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

/**
 * Elle yazılmış alan-zengin audit kayıtlarının yanında güvenlik ağıdır. Kimliği
 * doğrulanmış bütün başarılı mutasyonları kaydeder; yeni route eklenince audit
 * unutulamaz. Gövde bilinçli olarak kaydedilmez (şifre/sır sızıntısını önler).
 */
export function registerMutationAuditHook(app: import('fastify').FastifyInstance): void {
  app.addHook('onResponse', async (request, reply) => {
    if (!request.staffUser || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
    if (reply.statusCode >= 400) return;
    const params = request.params as { id?: string; ticketId?: string } | undefined;
    await createAuditLog({
      entityType: 'api_mutation',
      entityId: params?.id ?? params?.ticketId ?? request.staffUser.id,
      action: `${request.method} ${request.routeOptions.url}`,
      changes: { statusCode: reply.statusCode },
      performedBy: request.staffUser.email,
      ipAddress: (request.headers['x-real-ip'] as string | undefined) ?? request.ip,
    });
  });
}
