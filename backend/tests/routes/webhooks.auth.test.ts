import { describe, it, expect, vi } from 'vitest';
import { StaffRole } from '@prisma/client';
import { buildTestApp, authHeader } from '../helpers/app.js';

vi.mock('../../src/jobs/queue.js', () => ({ queueWebhookDelivery: vi.fn() }));
vi.mock('../../src/middleware/audit.js', () => ({ createAuditLog: vi.fn(async () => undefined) }));
const { webhookRoutes } = await import('../../src/modules/webhooks/webhooks.routes.js');

function makeApp() {
  const create = vi.fn();
  const app = buildTestApp({ webhook: { findMany: vi.fn(async () => []), create }, company: { findUnique: vi.fn() } });
  app.setErrorHandler((err: { statusCode?: number; message: string }, _req, reply) => {
    reply.status(err.statusCode ?? 500).send({ success: false, error: err.message });
  });
  app.register(webhookRoutes, { prefix: '/webhooks' });
  return { app, create };
}

describe('webhook yönetimi yetkisi', () => {
  it.each([StaffRole.it_manager, StaffRole.it_staff])('%s erişemez', async (role) => {
    const { app, create } = makeApp();
    expect((await app.inject({ method: 'GET', url: '/webhooks', headers: authHeader(role) })).statusCode).toBe(403);
    const res = await app.inject({
      method: 'POST', url: '/webhooks', headers: authHeader(role),
      payload: { name: 'x', kind: 'slack', url: 'https://hooks.slack.com/x', events: ['ticket.created'] },
    });
    expect(res.statusCode).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it('yalnızca http(s) adresleri ve bilinen olaylar kabul edilir', async () => {
    const { app, create } = makeApp();
    const bad = [
      { name: 'x', kind: 'generic', url: 'file:///etc/passwd', events: ['ticket.created'] },
      { name: 'x', kind: 'generic', url: 'https://ok.example.com', events: ['ticket.internal_note'] },
    ];
    for (const payload of bad) {
      expect((await app.inject({ method: 'POST', url: '/webhooks', headers: authHeader(StaffRole.admin), payload })).statusCode).toBe(400);
    }
    expect(create).not.toHaveBeenCalled();
  });
});
