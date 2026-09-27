import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { signBody, slackBody, teamsBody, type WebhookPayload } from '../../src/services/webhooks/format.js';

vi.mock('../../src/utils/net-guard.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/utils/net-guard.js')>();
  return {
    ...original,
    assertIntegrationHost: async (host: string) => {
      if (host === 'internal.local') throw new original.BlockedHostError(host);
    },
  };
});
const { buildRequest, deliverWebhook, emitWebhookEvent } = await import('../../src/services/webhooks/dispatch.js');
const { encrypt } = await import('../../src/utils/crypto.js');

const payload: WebhookPayload = {
  event: 'ticket.status_changed',
  timestamp: '2026-07-20T10:00:00.000Z',
  ticket: {
    id: 't1', number: 'TKT-2026-00001', subject: 'Yazıcı <kağıt> sıkışıyor & ses', status: 'resolved', priority: 'high',
    company: 'Acme', category: 'Donanım', assignee: 'Ali', requester: 'a@acme.com', url: 'http://x/staff/tickets/t1',
  },
  data: { from: 'in_progress', to: 'resolved' },
};

describe('biçimler ve imza', () => {
  it('imza zaman damgası + gövde üzerinden HMAC-SHA256', () => {
    const expected = createHmac('sha256', 'sec').update('123.{"a":1}').digest('hex');
    expect(signBody('sec', '123', '{"a":1}')).toBe(`sha256=${expected}`);
  });

  it('genel webhook imzalı ve olay başlıklı gider', () => {
    const req = buildRequest('generic', 'https://hook.example.com/x', 'sec', 'd1', payload);
    expect(JSON.parse(req.body)).toEqual(payload);
    expect(req.headers).toMatchObject({ 'x-ticket-event': 'ticket.status_changed', 'x-ticket-delivery': 'd1' });
    expect(req.headers['x-ticket-signature']).toBe(signBody('sec', req.headers['x-ticket-timestamp'], req.body));
  });

  it('Teams: Adaptive Card; Slack: Block Kit ve kaçışlanmış metin', () => {
    const teams = teamsBody(payload) as { attachments: Array<{ contentType: string; content: { actions: Array<{ url: string }> } }> };
    expect(teams.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(teams.attachments[0].content.actions[0].url).toBe('http://x/staff/tickets/t1');
    const slack = JSON.stringify(slackBody(payload));
    expect(slack).toContain('&lt;kağıt&gt;');
    expect(slack).toContain('&amp; ses');
    expect(slack).toContain('in_progress → resolved');
  });

  it('Teams/Slack istekleri imza başlığı taşımaz', () => {
    expect(buildRequest('slack', 'https://hooks.slack.com/x', null, 'd1', payload).headers).not.toHaveProperty('x-ticket-signature');
  });
});

describe('emitWebhookEvent', () => {
  it('yalnızca olaya abone ve şirketi tutan aktif webhook\'lara teslimat açar', async () => {
    const create = vi.fn(async () => ({ id: 'd-new' }));
    const findMany = vi.fn(async () => [
      { id: 'h1', events: ['ticket.status_changed'] },
      { id: 'h2', events: ['ticket.created'] },
    ]);
    const prisma = {
      ticket: { findUnique: vi.fn(async ({ select }: { select: Record<string, unknown> }) => ('ticketNumber' in select ? { id: 't1', ticketNumber: 'N', subject: 's', status: 'open', priority: 'low', createdByEmail: 'a@b.c', companyId: 'co', company: { name: 'C' }, category: null, assignedTo: null } : { companyId: 'co' })) },
      webhook: { findMany },
      webhookDelivery: { create },
    } as unknown as PrismaClient;
    const enqueue = vi.fn(async () => undefined);
    await emitWebhookEvent(prisma, enqueue, 'ticket.status_changed', 't1', { from: 'open', to: 'in_progress' });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true, OR: [{ companyId: null }, { companyId: 'co' }] } }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ webhookId: 'h1', event: 'ticket.status_changed' }) }));
    expect(enqueue).toHaveBeenCalledWith('d-new');
  });

  it('hata fırlatmaz (bildirim arızası ticket işlemini bozmamalı)', async () => {
    const prisma = { ticket: { findUnique: async () => { throw new Error('db down'); } } } as unknown as PrismaClient;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(emitWebhookEvent(prisma, vi.fn(), 'ticket.created', 't1')).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe('deliverWebhook', () => {
  function prismaFor(url: string, isActive = true) {
    const deliveryUpdate = vi.fn(async () => ({}));
    const webhookUpdate = vi.fn(async () => ({}));
    const prisma = {
      webhookDelivery: {
        findUnique: async () => ({
          id: 'd1', payload,
          webhook: { id: 'h1', kind: 'generic', isActive, urlEnc: encrypt(url), secretEnc: encrypt('sec') },
        }),
        update: deliveryUpdate,
      },
      webhook: { update: webhookUpdate },
    } as unknown as PrismaClient;
    return { prisma, deliveryUpdate, webhookUpdate };
  }

  it('2xx → success; yönlendirme izlenmez', async () => {
    const { prisma, deliveryUpdate } = prismaFor('https://hook.example.com/in');
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
    await deliverWebhook(prisma, 'd1', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith('https://hook.example.com/in', expect.objectContaining({ method: 'POST', redirect: 'manual' }));
    expect(deliveryUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'success', statusCode: 200 }) }));
  });

  it('3xx/5xx → failed ve yeniden deneme için fırlatır', async () => {
    for (const status of [302, 503]) {
      const { prisma, deliveryUpdate, webhookUpdate } = prismaFor('https://hook.example.com/in');
      const fetchImpl = vi.fn(async () => new Response(null, { status }));
      await expect(deliverWebhook(prisma, 'd1', fetchImpl as unknown as typeof fetch)).rejects.toThrow(`HTTP ${status}`);
      expect(deliveryUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed', statusCode: status }) }));
      expect(webhookUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { lastError: `HTTP ${status}` } }));
    }
  });

  it('SSRF: engelli hedefe istek atılmaz', async () => {
    const { prisma } = prismaFor('http://internal.local/hook');
    const fetchImpl = vi.fn();
    await expect(deliverWebhook(prisma, 'd1', fetchImpl as unknown as typeof fetch)).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('pasif webhook teslim edilmez', async () => {
    const { prisma } = prismaFor('https://hook.example.com/in', false);
    const fetchImpl = vi.fn();
    await deliverWebhook(prisma, 'd1', fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
