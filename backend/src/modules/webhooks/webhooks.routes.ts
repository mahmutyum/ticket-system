import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { WebhookKind, type Prisma, type Webhook } from '@prisma/client';
import { config } from '../../config/index.js';
import { queueWebhookDelivery } from '../../jobs/queue.js';
import { createAuditLog } from '../../middleware/audit.js';
import { deliverWebhook } from '../../services/webhooks/dispatch.js';
import { newWebhookSecret, WEBHOOK_EVENTS, type WebhookPayload } from '../../services/webhooks/format.js';
import { commonErrorResponses, successResponseSchema } from '../../utils/api-schema.js';
import { decrypt, encrypt } from '../../utils/crypto.js';
import { assertIntegrationHost, BlockedHostError } from '../../utils/net-guard.js';
import { t } from '../../i18n/index.js';

/**
 * Giden webhook'lar ve Teams/Slack kanalları — yalnızca admin.
 *
 * Hedef URL ve imza sırrı şifreli saklanır; liste yalnızca host'u gösterir. Genel
 * webhook sırrı yalnızca oluşturma/yenileme yanıtında BİR KEZ döner.
 */

const idParams = z.object({ id: z.string().min(1).max(128) });
const deliveryParams = z.object({ deliveryId: z.string().min(1).max(128) });
const httpUrl = z.string().url().max(2000).refine(u => /^https?:$/.test(new URL(u).protocol), { message: 'http(s)' });

const bodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.nativeEnum(WebhookKind),
  /** Güncellemede boş bırakılırsa kayıtlı adres korunur. */
  url: httpUrl.optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  companyId: z.string().max(128).nullable().default(null),
  isActive: z.boolean().default(true),
});

const viewSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.nativeEnum(WebhookKind),
  host: z.string(),
  events: z.array(z.string()),
  companyId: z.string().nullable(),
  isActive: z.boolean(),
  hasSecret: z.boolean(),
  lastDeliveredAt: z.date().nullable(),
  lastError: z.string().nullable(),
});
const deliverySchema = z.object({
  id: z.string(), event: z.string(), status: z.string(), statusCode: z.number().nullable(),
  error: z.string().nullable(), attempts: z.number(), createdAt: z.date(), deliveredAt: z.date().nullable(),
});

function hostOf(urlEnc: string): string {
  try {
    return new URL(decrypt(urlEnc)).host;
  } catch {
    return '?';
  }
}

const toView = (w: Webhook) => ({
  id: w.id, name: w.name, kind: w.kind, host: hostOf(w.urlEnc),
  events: Array.isArray(w.events) ? (w.events as string[]) : [],
  companyId: w.companyId, isActive: w.isActive, hasSecret: !!w.secretEnc,
  lastDeliveredAt: w.lastDeliveredAt, lastError: w.lastError,
});

const withSecret = viewSchema.extend({ secret: z.string().optional() });

export const webhookRoutes: FastifyPluginAsyncZod = async (app) => {
  const adminOnly = [app.requireRole('admin')];
  const ip = (request: FastifyRequest) => (request.headers['x-real-ip'] as string) || request.ip;

  async function checkUrl(request: FastifyRequest, reply: FastifyReply, url: string): Promise<boolean> {
    try {
      await assertIntegrationHost(new URL(url).hostname, config.ALLOW_PRIVATE_INTEGRATION_HOSTS);
      return true;
    } catch (err) {
      if (err instanceof BlockedHostError) {
        reply.status(400).send({ success: false, error: t(request, 'webhooks.host_blocked') });
        return false;
      }
      throw err;
    }
  }

  async function checkCompany(request: FastifyRequest, reply: FastifyReply, companyId: string | null): Promise<boolean> {
    if (!companyId) return true;
    const exists = await app.prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
    if (!exists) reply.status(400).send({ success: false, error: t(request, 'webhooks.company_not_found') });
    return !!exists;
  }

  app.get('/', {
    preValidation: adminOnly,
    schema: { tags: ['Webhooks'], summary: 'Webhook listesi', response: { 200: z.object({ success: z.literal(true), data: z.array(viewSchema) }), ...commonErrorResponses } },
  }, async (_request, reply) => {
    const hooks = await app.prisma.webhook.findMany({ orderBy: { createdAt: 'asc' } });
    reply.send({ success: true, data: hooks.map(toView) });
  });

  app.post('/', {
    preValidation: adminOnly,
    schema: { tags: ['Webhooks'], summary: 'Webhook ekler', body: bodySchema, response: { 200: z.object({ success: z.literal(true), data: withSecret }), ...commonErrorResponses } },
  }, async (request, reply) => {
    const body = request.body;
    if (!body.url) return reply.status(400).send({ success: false, error: t(request, 'webhooks.url_required') });
    if (!(await checkUrl(request, reply, body.url)) || !(await checkCompany(request, reply, body.companyId))) return;
    const secret = body.kind === WebhookKind.generic ? newWebhookSecret() : undefined;
    const hook = await app.prisma.webhook.create({
      data: {
        name: body.name, kind: body.kind, urlEnc: encrypt(body.url), secretEnc: secret ? encrypt(secret) : null,
        events: body.events, companyId: body.companyId, isActive: body.isActive,
      },
    });
    await createAuditLog({
      entityType: 'webhook', entityId: hook.id, action: 'create',
      changes: { name: body.name, kind: body.kind, host: new URL(body.url).host, events: body.events },
      performedBy: request.staffUser!.email, ipAddress: ip(request),
    });
    reply.send({ success: true, data: { ...toView(hook), secret } });
  });

  app.put('/:id', {
    preValidation: adminOnly,
    schema: { tags: ['Webhooks'], summary: 'Webhook günceller', params: idParams, body: bodySchema, response: { 200: z.object({ success: z.literal(true), data: viewSchema }), ...commonErrorResponses } },
  }, async (request, reply) => {
    const existing = await app.prisma.webhook.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.status(404).send({ success: false, error: t(request, 'webhooks.not_found') });
    const body = request.body;
    if (body.url && !(await checkUrl(request, reply, body.url))) return;
    if (!(await checkCompany(request, reply, body.companyId))) return;
    // Genel webhook'a geçişte sır yoksa üretilir (yenileme ucuyla görülebilir).
    const needsSecret = body.kind === WebhookKind.generic && !existing.secretEnc;
    const hook = await app.prisma.webhook.update({
      where: { id: existing.id },
      data: {
        name: body.name, kind: body.kind, events: body.events, companyId: body.companyId, isActive: body.isActive,
        ...(body.url ? { urlEnc: encrypt(body.url) } : {}),
        ...(needsSecret ? { secretEnc: encrypt(newWebhookSecret()) } : {}),
      },
    });
    await createAuditLog({
      entityType: 'webhook', entityId: hook.id, action: 'update',
      changes: { name: body.name, kind: body.kind, events: body.events, isActive: body.isActive, urlChanged: !!body.url },
      performedBy: request.staffUser!.email, ipAddress: ip(request),
    });
    reply.send({ success: true, data: toView(hook) });
  });

  app.delete('/:id', {
    preValidation: adminOnly,
    schema: { tags: ['Webhooks'], summary: 'Webhook siler', params: idParams, response: { 200: successResponseSchema, ...commonErrorResponses } },
  }, async (request, reply) => {
    const result = await app.prisma.webhook.deleteMany({ where: { id: request.params.id } });
    if (result.count === 0) return reply.status(404).send({ success: false, error: t(request, 'webhooks.not_found') });
    await createAuditLog({ entityType: 'webhook', entityId: request.params.id, action: 'delete', changes: {}, performedBy: request.staffUser!.email, ipAddress: ip(request) });
    reply.send({ success: true });
  });

  app.post('/:id/rotate-secret', {
    preValidation: adminOnly,
    schema: { tags: ['Webhooks'], summary: 'İmza sırrını yeniler', params: idParams, response: { 200: z.object({ success: z.literal(true), data: z.object({ secret: z.string() }) }), ...commonErrorResponses } },
  }, async (request, reply) => {
    const existing = await app.prisma.webhook.findUnique({ where: { id: request.params.id } });
    if (!existing || existing.kind !== WebhookKind.generic) return reply.status(404).send({ success: false, error: t(request, 'webhooks.not_found') });
    const secret = newWebhookSecret();
    await app.prisma.webhook.update({ where: { id: existing.id }, data: { secretEnc: encrypt(secret) } });
    await createAuditLog({ entityType: 'webhook', entityId: existing.id, action: 'rotate_secret', changes: {}, performedBy: request.staffUser!.email, ipAddress: ip(request) });
    reply.send({ success: true, data: { secret } });
  });

  // Test: `ping` olayını hemen (kuyruksuz) gönderir ve sonucu döner.
  app.post('/:id/test', {
    preValidation: adminOnly,
    schema: { tags: ['Webhooks'], summary: 'Test bildirimi gönderir', params: idParams, response: { 200: z.object({ success: z.literal(true), data: deliverySchema }), ...commonErrorResponses } },
  }, async (request, reply) => {
    const hook = await app.prisma.webhook.findUnique({ where: { id: request.params.id } });
    if (!hook) return reply.status(404).send({ success: false, error: t(request, 'webhooks.not_found') });
    const payload: WebhookPayload = { event: 'ping', timestamp: new Date().toISOString(), ticket: null, data: { message: 'Ticket System webhook test' } };
    const delivery = await app.prisma.webhookDelivery.create({
      data: { webhookId: hook.id, event: 'ping', payload: payload as unknown as Prisma.InputJsonValue },
    });
    await deliverWebhook(app.prisma, delivery.id).catch(() => undefined);
    const result = await app.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    reply.send({ success: true, data: result });
  });

  app.get('/:id/deliveries', {
    preValidation: adminOnly,
    schema: { tags: ['Webhooks'], summary: 'Son teslimatlar', params: idParams, response: { 200: z.object({ success: z.literal(true), data: z.array(deliverySchema) }), ...commonErrorResponses } },
  }, async (request, reply) => {
    const deliveries = await app.prisma.webhookDelivery.findMany({
      where: { webhookId: request.params.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, event: true, status: true, statusCode: true, error: true, attempts: true, createdAt: true, deliveredAt: true },
    });
    reply.send({ success: true, data: deliveries });
  });

  app.post('/deliveries/:deliveryId/retry', {
    preValidation: adminOnly,
    schema: { tags: ['Webhooks'], summary: 'Teslimatı yeniden dener', params: deliveryParams, response: { 200: successResponseSchema, ...commonErrorResponses } },
  }, async (request, reply) => {
    const delivery = await app.prisma.webhookDelivery.findUnique({ where: { id: request.params.deliveryId }, select: { id: true } });
    if (!delivery) return reply.status(404).send({ success: false, error: t(request, 'webhooks.not_found') });
    await app.prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { status: 'pending' } });
    await queueWebhookDelivery(delivery.id);
    reply.send({ success: true });
  });
};
