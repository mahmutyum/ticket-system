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

  it('OpenAPI yönetim route gövdelerini ve parametrelerini yayınlar', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(response.statusCode).toBe(200);
    const document = response.json();
    // Fastify, prefix altında '/' olarak kayıtlı kök route'ları OpenAPI'da
    // trailing slash ile yayınlayabilir (`/companies/`). İkisi aynı HTTP
    // kaynağıdır; test serializer biçimine değil sözleşmenin varlığına bakar.
    const path = (name: string) => document.paths[name] ?? document.paths[`${name}/`];
    expect(path('/companies'), `OpenAPI path yok. Mevcut yollar: ${Object.keys(document.paths).join(', ')}`).toBeDefined();
    expect(path('/companies').post.requestBody).toBeDefined();
    expect(document.paths['/staff/{id}'].put.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'id', in: 'path' })]),
    );
    expect(document.paths['/categories/reorder'].put.requestBody).toBeDefined();
    expect(document.paths['/templates/email'].post.requestBody).toBeDefined();
    expect(path('/onsite-support').get.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'status', in: 'query' })]),
    );
    expect(document.paths['/reports/overview'].get.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'period', in: 'query' })]),
    );
    expect(path('/tasks').post.requestBody).toBeDefined();
    expect(document.paths['/tasks/{id}/status'].patch.requestBody).toBeDefined();
    expect(document.paths['/attachments/{id}'].get.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'token', in: 'query' })]),
    );
    expect(document.paths['/events/staff'].get.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'ticket', in: 'query' })]),
    );
    expect(path('/tickets').post.requestBody).toBeDefined();
    expect(path('/tickets').get.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'status', in: 'query' })]),
    );
    expect(document.paths['/tickets/{id}'].put.requestBody).toBeDefined();
    expect(document.paths['/tickets/bulk'].post.requestBody).toBeDefined();
    expect(document.paths['/public/ticket/{accessToken}/reply'].post.requestBody).toBeDefined();
    expect(document.paths['/public/track'].post.requestBody).toBeDefined();
    expect(document.paths['/tickets/{ticketId}/notes'].post.requestBody).toBeDefined();
    expect(path('/credentials').post.requestBody).toBeDefined();
    expect(document.paths['/credentials/{id}/reveal'].get.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'id', in: 'path' })]),
    );
    expect(document.paths['/auth/staff/change-password'].post.requestBody).toBeDefined();
    expect(document.paths['/auth/staff/mfa/enable'].post.requestBody).toBeDefined();
    expect(document.paths['/auth/staff/sessions'].get.summary).toBeDefined();
  });
});
