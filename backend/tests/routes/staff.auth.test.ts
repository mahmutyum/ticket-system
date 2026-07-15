import { describe, it, expect, vi } from 'vitest';
import { StaffRole } from '@prisma/client';
import { buildTestApp, authHeader } from '../helpers/app.js';

/**
 * `PUT /staff/:id/companies` — ayrıcalık yükseltmesi regresyon testi.
 *
 * Bu uç nokta bir zamanlar `requireRole('admin', 'it_manager')` ile korunuyordu
 * ve handler hedefin çağıranın kendisi olup olmadığına bakmıyordu. Kapsamlı bir
 * it_manager `PUT /staff/<kendi-id>/companies` ile tüm şirketleri kendine atayıp
 * sınırsız erişim kazanabiliyordu — kapsam her istekte DB'den okunduğu için
 * etkisi anındaydı, token yenilemeye bile gerek yoktu.
 *
 * Şirket ataması bir YETKİ kararıdır; admin'de kalmalıdır. Bu test o kapıyı
 * tutar: `it_manager` buraya tekrar eklenirse test kırılır.
 */

vi.mock('../../src/db.js', () => ({
  prisma: { auditLog: { create: vi.fn() } },
}));

function makeApp() {
  const deleteMany = vi.fn(async () => ({ count: 0 }));
  const createMany = vi.fn(async () => ({ count: 1 }));
  const prisma = { staffCompany: { deleteMany, createMany, findMany: async () => [] } };
  const app = buildTestApp(prisma, { del: vi.fn() });
  return { app, deleteMany, createMany };
}

async function withRoutes(app: any) {
  const { staffRoutes } = await import('../../src/modules/staff/staff.routes.js');
  app.register(staffRoutes, { prefix: '/staff' });
  await app.ready();
  return app;
}

const VALID_CUID = 'clxxxxxxxxxxxxxxxxxxxxxxx';

describe('PUT /staff/:id/companies — şirket ataması', () => {
  it('token yoksa 401', async () => {
    const { app } = makeApp();
    await withRoutes(app);
    const res = await app.inject({ method: 'PUT', url: '/staff/other/companies', payload: { companyIds: [] } });
    expect(res.statusCode).toBe(401);
  });

  it('it_manager BAŞKASINA şirket atayamaz', async () => {
    const { app, createMany } = makeApp();
    await withRoutes(app);
    const res = await app.inject({
      method: 'PUT', url: '/staff/someone-else/companies',
      headers: authHeader(StaffRole.it_manager, 'manager-1'),
      payload: { companyIds: [VALID_CUID] },
    });
    expect(res.statusCode).toBe(403);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('it_manager KENDİNE şirket atayamaz — ayrıcalık yükseltmesi kapalı', async () => {
    const { app, deleteMany, createMany } = makeApp();
    await withRoutes(app);
    const res = await app.inject({
      method: 'PUT', url: '/staff/manager-1/companies',
      headers: authHeader(StaffRole.it_manager, 'manager-1'),
      payload: { companyIds: [VALID_CUID] },
    });
    expect(res.statusCode).toBe(403);
    // Yazma yoluna hiç girilmemeli.
    expect(deleteMany).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it('it_staff atama yapamaz', async () => {
    const { app } = makeApp();
    await withRoutes(app);
    const res = await app.inject({
      method: 'PUT', url: '/staff/x/companies',
      headers: authHeader(StaffRole.it_staff),
      payload: { companyIds: [] },
    });
    expect(res.statusCode).toBe(403);
  });

  it('admin atama yapabilir', async () => {
    const { app, createMany } = makeApp();
    await withRoutes(app);
    const res = await app.inject({
      method: 'PUT', url: '/staff/target/companies',
      headers: authHeader(StaffRole.admin),
      payload: { companyIds: [VALID_CUID] },
    });
    expect(res.statusCode).toBe(200);
    expect(createMany).toHaveBeenCalledOnce();
  });
});

describe('POST /staff — personel oluşturma', () => {
  it('it_manager personel oluşturamaz (rol atayamaz)', async () => {
    const { app } = makeApp();
    await withRoutes(app);
    const res = await app.inject({
      method: 'POST', url: '/staff',
      headers: authHeader(StaffRole.it_manager),
      payload: { email: 'x@y.z', fullName: 'X', password: 'password123', role: 'admin' },
    });
    expect(res.statusCode).toBe(403);
  });
});
