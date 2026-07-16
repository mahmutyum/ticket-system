import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

beforeAll(async () => {
  const module = await import('../../src/app.js');
  app = await module.buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('gerçek PostgreSQL + Redis entegrasyonu', () => {
  it('readiness iki bağımlılığı da doğrular', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ready' });
  });

  it('seed admin gerçek Prisma sorgusu ve bcrypt ile giriş yapar', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/staff/login',
      payload: { email: 'admin@company.com', password: 'admin123' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      accessToken: expect.any(String),
      user: { email: 'admin@company.com', role: 'admin' },
    });
    expect(response.headers['set-cookie']).toContain('refresh_token=');
  });

  it('geçersiz Zod gövdesini route sözleşmesinde 400 yapar', async () => {
    const response = await app.inject({ method: 'POST', url: '/auth/staff/login', payload: {} });
    expect(response.statusCode).toBe(400);
  });
});
