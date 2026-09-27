import type { PrismaClient } from '@prisma/client';
import { queueWebhookDelivery } from '../../jobs/queue.js';
import { emitWebhookEvent } from './dispatch.js';
import type { WebhookEvent } from './format.js';

/** Uygulama içi kısayol: olayı gerçek teslimat kuyruğuna bağlar. Asla fırlatmaz. */
export function emitTicketEvent(
  prisma: PrismaClient,
  event: WebhookEvent,
  ticketId: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  return emitWebhookEvent(prisma, queueWebhookDelivery, event, ticketId, data);
}

/** Durum/öncelik/atama değişikliklerini ayrı olaylar olarak yayınlar. */
export async function emitTicketChanges(
  prisma: PrismaClient,
  ticketId: string,
  before: { status: string; priority: string; assignedToId: string | null },
  after: { status?: string; priority?: string; assignedToId?: string | null; assigneeName?: string | null },
): Promise<void> {
  if (after.status && after.status !== before.status) {
    await emitTicketEvent(prisma, 'ticket.status_changed', ticketId, { from: before.status, to: after.status });
  }
  if (after.priority && after.priority !== before.priority) {
    await emitTicketEvent(prisma, 'ticket.priority_changed', ticketId, { from: before.priority, to: after.priority });
  }
  if (after.assignedToId !== undefined && after.assignedToId !== before.assignedToId) {
    await emitTicketEvent(prisma, 'ticket.assigned', ticketId, { to: after.assigneeName ?? null });
  }
}
