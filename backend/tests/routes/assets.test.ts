import { describe, it, expect, vi } from 'vitest';
import { StaffRole } from '@prisma/client';
import { buildTestApp, authHeader, scopeStub } from '../helpers/app.js';

vi.mock('../../src/middleware/audit.js', () => ({ createAuditLog: vi.fn(async () => undefined) }));
const { assetRoutes } = await import('../../src/modules/assets/assets.routes.js');

const body = { companyId: 'co-in', tag: 'LT-1', name: 'Laptop', assetType: 'Laptop' };

function makeApp(existing: Record<string, unknown> | null = null) {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'a1', createdAt: new Date(), updatedAt: new Date(), company: { name: 'C' }, location: null, _count: { tickets: 0 },
    serialNumber: null, locationId: null, assignedToEmail: null, notes: null, isActive: true, ...data,
  }));
  const findMany = vi.fn(async () => []);
  const prisma = {
    staffCompany: scopeStub(['co-in']),
    asset: { create, findMany, findUnique: vi.fn(async () => existing), update: vi.fn(), delete: vi.fn() },
    location: { findFirst: vi.fn(async ({ where }: { where: { companyId: string } }) => (where.companyId === 'co-in' ? { id: 'loc' } : null)), findMany: vi.fn(async () => []) },
  };
  const app = buildTestApp(prisma);
  app.setErrorHandler((err: { statusCode?: number; message: string }, _req, reply) => {
    reply.status(err.statusCode ?? 500).send({ success: false, error: err.message });
  });
  app.register(assetRoutes, { prefix: '/assets' });
  return { app, create, findMany };
}

describe('varlık yetkisi', () => {
  it('kapsam içi it_manager ekler; kapsam dışı reddedilir; it_staff yazamaz', async () => {
    const { app, create } = makeApp();
    expect((await app.inject({ method: 'POST', url: '/assets', headers: authHeader(StaffRole.it_manager), payload: body })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/assets', headers: authHeader(StaffRole.it_manager), payload: { ...body, companyId: 'co-out' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/assets', headers: authHeader(StaffRole.it_staff), payload: body })).statusCode).toBe(403);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('liste kapsamla kesişir (başka şirket filtresi boş döner)', async () => {
    const { app, findMany } = makeApp();
    const res = await app.inject({ method: 'GET', url: '/assets?companyId=co-out', headers: authHeader(StaffRole.it_staff) });
    expect(res.json().data).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('şirket değiştirilemez', async () => {
    const { app } = makeApp({ id: 'a1', companyId: 'co-in' });
    const res = await app.inject({ method: 'PUT', url: '/assets/a1', headers: authHeader(StaffRole.admin), payload: { ...body, companyId: 'co-other' } });
    expect(res.statusCode).toBe(400);
  });

  it('kapsam dışı varlık detayı 404', async () => {
    const { app } = makeApp({ id: 'a1', companyId: 'co-out', tickets: [] });
    expect((await app.inject({ method: 'GET', url: '/assets/a1', headers: authHeader(StaffRole.it_staff) })).statusCode).toBe(404);
  });
});
