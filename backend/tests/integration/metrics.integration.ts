import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

/** Prometheus /metrics — Bearer token, gerçek kuyruk/DB göstergeleri, düşük kardinalite. */

const TOKEN = 'metrics-token-for-integration-tests';
process.env.METRICS_TOKEN = TOKEN;

let app: FastifyInstance;

beforeAll(async () => {
  const module = await import('../../src/app.js');
  app = await module.buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('/metrics', () => {
  it('token olmadan / yanlış token ile 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: 'Bearer wrong-token-wrong-token-xx' } })).statusCode).toBe(401);
  });

  it('göstergeleri Prometheus biçiminde döner; HTTP etiketi route şablonudur', async () => {
    await app.inject({ method: 'GET', url: '/public/ticket/does-not-exist-token' });
    const res = await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    for (const name of ['ticket_queue_jobs', 'ticket_open_tickets', 'ticket_sla_breaches_open', 'ticket_notifications_failed', 'ticket_sse_connections', 'ticket_http_request_duration_seconds_bucket', 'ticket_process_cpu_user_seconds_total']) {
      expect(res.body, name).toContain(name);
    }
    expect(res.body).toMatch(/ticket_queue_jobs\{queue="email",state="waiting"\}/);
    expect(res.body).toContain('route="/public/ticket/:accessToken"');
    expect(res.body).not.toContain('does-not-exist-token');
  });
});
