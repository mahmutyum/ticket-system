import { WebhookKind, type Prisma, type PrismaClient } from '@prisma/client';
import { config } from '../../config/index.js';
import { decrypt } from '../../utils/crypto.js';
import { assertIntegrationHost } from '../../utils/net-guard.js';
import { signBody, slackBody, teamsBody, type WebhookEvent, type WebhookPayload, type WebhookTicket } from './format.js';

/**
 * Webhook olay üretimi ve teslimatı.
 *
 * `emitWebhookEvent` yalnızca kayıt açıp kuyruğa atar (istek yolunu yavaşlatmaz, hata
 * atmaz). `deliverWebhook` kuyruk işçisinde çalışır; başarısızlıkta fırlatır ve BullMQ
 * üstel beklemeyle yeniden dener.
 */

export type EnqueueDelivery = (deliveryId: string) => Promise<unknown>;

const DELIVERY_TIMEOUT_MS = 10_000;

export async function webhookTicket(prisma: Pick<PrismaClient, 'ticket'>, ticketId: string): Promise<WebhookTicket | null> {
  const t = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true, ticketNumber: true, subject: true, status: true, priority: true, createdByEmail: true, companyId: true,
      company: { select: { name: true } }, category: { select: { name: true } }, assignedTo: { select: { fullName: true } },
    },
  });
  if (!t) return null;
  return {
    id: t.id,
    number: t.ticketNumber,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    company: t.company.name,
    category: t.category?.name ?? null,
    assignee: t.assignedTo?.fullName ?? null,
    requester: t.createdByEmail,
    url: `${config.CANONICAL_URL}/staff/tickets/${t.id}`,
  };
}

/**
 * Ticket olayı için eşleşen aktif webhook'lara teslimat açar.
 * Hata YUTULUR (loglanır): bildirim kanalı arızası ticket işlemini bozmamalı.
 */
export async function emitWebhookEvent(
  prisma: PrismaClient,
  enqueue: EnqueueDelivery,
  event: WebhookEvent,
  ticketId: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  try {
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { companyId: true } });
    if (!ticket) return;
    const hooks = await prisma.webhook.findMany({
      where: { isActive: true, OR: [{ companyId: null }, { companyId: ticket.companyId }] },
      select: { id: true, events: true },
    });
    const targets = hooks.filter(h => Array.isArray(h.events) && (h.events as string[]).includes(event));
    if (targets.length === 0) return;
    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      ticket: await webhookTicket(prisma, ticketId),
      data,
    };
    for (const hook of targets) {
      const delivery = await prisma.webhookDelivery.create({
        data: { webhookId: hook.id, event, payload: payload as unknown as Prisma.InputJsonValue },
        select: { id: true },
      });
      await enqueue(delivery.id);
    }
  } catch (err) {
    console.error('[Webhook] emit failed', event, err);
  }
}

export interface DeliveryRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Kanala göre gövde + başlıklar. Genel webhook imzalıdır. */
export function buildRequest(kind: WebhookKind, url: string, secret: string | null, deliveryId: string, payload: WebhookPayload): DeliveryRequest {
  const bodyObject = kind === WebhookKind.teams ? teamsBody(payload) : kind === WebhookKind.slack ? slackBody(payload) : payload;
  const body = JSON.stringify(bodyObject);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'user-agent': 'ticket-system-webhooks/1' };
  if (kind === WebhookKind.generic) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    headers['x-ticket-event'] = payload.event;
    headers['x-ticket-delivery'] = deliveryId;
    headers['x-ticket-timestamp'] = timestamp;
    if (secret) headers['x-ticket-signature'] = signBody(secret, timestamp, body);
  }
  return { url, headers, body };
}

export async function deliverWebhook(
  prisma: PrismaClient,
  deliveryId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const delivery = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { webhook: true } });
  if (!delivery || !delivery.webhook.isActive) return;
  const hook = delivery.webhook;
  const now = new Date();
  try {
    const url = decrypt(hook.urlEnc);
    // Hedef her teslimatta yeniden denetlenir (DNS rebinding); yönlendirme izlenmez —
    // aksi hâlde dış bir adres 302 ile iç ağa yönlendirebilirdi.
    await assertIntegrationHost(new URL(url).hostname, config.ALLOW_PRIVATE_INTEGRATION_HOSTS);
    const req = buildRequest(hook.kind, url, hook.secretEnc ? decrypt(hook.secretEnc) : null, delivery.id, delivery.payload as unknown as WebhookPayload);
    const res = await fetchImpl(req.url, {
      method: 'POST',
      headers: req.headers,
      body: req.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (res.status < 200 || res.status >= 300) throw Object.assign(new Error(`HTTP ${res.status}`), { statusCode: res.status });
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: 'success', statusCode: res.status, error: null, attempts: { increment: 1 }, deliveredAt: now },
    });
    await prisma.webhook.update({ where: { id: hook.id }, data: { lastDeliveredAt: now, lastError: null } });
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'failed',
        statusCode: (err as { statusCode?: number }).statusCode ?? null,
        error: message,
        attempts: { increment: 1 },
      },
    });
    await prisma.webhook.update({ where: { id: hook.id }, data: { lastError: message } });
    throw err;
  }
}
