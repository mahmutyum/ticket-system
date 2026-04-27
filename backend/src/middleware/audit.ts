import { prisma } from '../db.js';

export async function createAuditLog(params: {
  entityType: string;
  entityId: string;
  action: string;
  changes?: Record<string, any>;
  performedBy: string;
  ipAddress?: string;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        changes: params.changes || {},
        performedBy: params.performedBy,
        ipAddress: params.ipAddress,
      },
    });
  } catch (err) {
    console.error('Audit log error:', err);
  }
}
