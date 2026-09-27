import { describe, it, expect, vi } from 'vitest';
import { StaffRole } from '@prisma/client';
import { buildTestApp, authHeader, scopeStub } from '../helpers/app.js';
import { companySlaRoutes } from '../../src/modules/companies/company-sla.routes.js';

/**
 * Şirket SLA ayarları / tatil takvimi: rol + şirket kapsamı + doğrulama.
 */

const IN_SCOPE = 'co-in';
const OUT_OF_SCOPE = 'co-out';

function makeApp() {
  const companyUpdate = vi.fn(async () => ({}));
  const holidayDeleteMany = vi.fn(async () => ({ count: 1 }));
  const prisma = {
    staffCompany: scopeStub([IN_SCOPE]),
    company: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, slaSettings: null })),
      update: companyUpdate,
    },
    companyHoliday: {
      findMany: vi.fn(async () => [{ id: 'h1', date: new Date('2026-10-29T00:00:00Z'), name: 'Cumhuriyet Bayramı' }]),
      deleteMany: holidayDeleteMany,
    },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  const app = buildTestApp(prisma);
  // Gerçek uygulamadaki gibi doğrulama hatası → 400 { success:false } (route'lardan ÖNCE).
  app.setErrorHandler((err: { statusCode?: number; message: string }, _req, reply) => {
    reply.status(err.statusCode ?? 500).send({ success: false, error: err.message });
  });
  app.register(companySlaRoutes, { prefix: '/companies' });
  return { app, companyUpdate, holidayDeleteMany };
}

const validBody = {
  businessHours: { enabled: true, timezone: 'Europe/Istanbul', week: { mon: [{ start: '09:00', end: '18:00' }] } },
  alwaysOnPriorities: ['critical'],
  warningPercent: 75,
  escalation: { notifyManagers: true, bumpPriority: false },
};

describe('GET /companies/:id/sla', () => {
  it('ayar yoksa varsayılanları ve tatilleri döner', async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: 'GET', url: `/companies/${IN_SCOPE}/sla`, headers: authHeader(StaffRole.it_manager) });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.settings).toMatchObject({ businessHours: null, warningPercent: 80, escalation: { notifyManagers: true } });
    expect(data.holidays).toEqual([{ id: 'h1', date: '2026-10-29', name: 'Cumhuriyet Bayramı' }]);
  });

  it('it_staff erişemez', async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: 'GET', url: `/companies/${IN_SCOPE}/sla`, headers: authHeader(StaffRole.it_staff) });
    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /companies/:id/sla', () => {
  it('kapsam içi it_manager güncelleyebilir', async () => {
    const { app, companyUpdate } = makeApp();
    const res = await app.inject({ method: 'PUT', url: `/companies/${IN_SCOPE}/sla`, headers: authHeader(StaffRole.it_manager), payload: validBody });
    expect(res.statusCode).toBe(200);
    expect(companyUpdate).toHaveBeenCalled();
  });

  it('kapsam DIŞI it_manager 403 — ve yazma olmaz', async () => {
    const { app, companyUpdate } = makeApp();
    const res = await app.inject({ method: 'PUT', url: `/companies/${OUT_OF_SCOPE}/sla`, headers: authHeader(StaffRole.it_manager), payload: validBody });
    expect(res.statusCode).toBe(403);
    expect(companyUpdate).not.toHaveBeenCalled();
  });

  it('admin kapsamdan bağımsız güncelleyebilir', async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: 'PUT', url: `/companies/${OUT_OF_SCOPE}/sla`, headers: authHeader(StaffRole.admin), payload: validBody });
    expect(res.statusCode).toBe(200);
  });

  it('geçersiz saat dilimi ve ters aralık reddedilir', async () => {
    const { app } = makeApp();
    const badTz = { ...validBody, businessHours: { ...validBody.businessHours, timezone: 'Nowhere/City' } };
    expect((await app.inject({ method: 'PUT', url: `/companies/${IN_SCOPE}/sla`, headers: authHeader(StaffRole.admin), payload: badTz })).statusCode).toBe(400);
    const badWindow = { ...validBody, businessHours: { ...validBody.businessHours, week: { mon: [{ start: '18:00', end: '09:00' }] } } };
    expect((await app.inject({ method: 'PUT', url: `/companies/${IN_SCOPE}/sla`, headers: authHeader(StaffRole.admin), payload: badWindow })).statusCode).toBe(400);
  });

  it('takvim açık ama hiç çalışma aralığı yoksa reddedilir', async () => {
    const { app, companyUpdate } = makeApp();
    const empty = { ...validBody, businessHours: { ...validBody.businessHours, week: {} } };
    const res = await app.inject({ method: 'PUT', url: `/companies/${IN_SCOPE}/sla`, headers: authHeader(StaffRole.admin), payload: empty });
    expect(res.statusCode).toBe(400);
    expect(companyUpdate).not.toHaveBeenCalled();
  });
});

describe('DELETE /companies/:id/holidays/:holidayId', () => {
  it('silme şirket koşuluyla yapılır — başka şirketin kaydı id ile silinemez', async () => {
    const { app, holidayDeleteMany } = makeApp();
    await app.inject({ method: 'DELETE', url: `/companies/${IN_SCOPE}/holidays/h9`, headers: authHeader(StaffRole.it_manager) });
    expect(holidayDeleteMany).toHaveBeenCalledWith({ where: { id: 'h9', companyId: IN_SCOPE } });
  });

  it('kapsam dışı şirkette 403', async () => {
    const { app, holidayDeleteMany } = makeApp();
    const res = await app.inject({ method: 'DELETE', url: `/companies/${OUT_OF_SCOPE}/holidays/h1`, headers: authHeader(StaffRole.it_manager) });
    expect(res.statusCode).toBe(403);
    expect(holidayDeleteMany).not.toHaveBeenCalled();
  });
});
