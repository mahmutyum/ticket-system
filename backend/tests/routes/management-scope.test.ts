import { describe, expect, it, vi } from 'vitest';
import { StaffRole } from '@prisma/client';
import { authHeader, buildTestApp } from '../helpers/app.js';

vi.mock('../../src/db.js', () => ({
  prisma: { auditLog: { create: vi.fn() } },
}));
vi.mock('../../src/jobs/queue.js', () => ({ queueEmail: vi.fn() }));
vi.mock('../../src/services/sse.service.js', () => ({ broadcastToStaff: vi.fn() }));

const MANAGER_ID = 'manager-1';
const COMPANY_ID = 'company-1';

function scopedPrisma() {
  const taskFindMany = vi.fn(async () => []);
  const onsiteFindMany = vi.fn(async () => []);
  const ticketFindMany = vi.fn<(args: unknown) => Promise<Record<string, unknown>[]>>(async () => []);
  const ticketCount = vi.fn(async () => 0);
  const notificationFindMany = vi.fn(async () => []);
  const notificationCount = vi.fn(async () => 0);
  return {
    prisma: {
      staffCompany: { findMany: vi.fn(async () => [{ companyId: COMPANY_ID }]) },
      task: { findMany: taskFindMany },
      onsiteSupport: { findMany: onsiteFindMany },
      ticket: { findMany: ticketFindMany, count: ticketCount },
      notification: { findMany: notificationFindMany, count: notificationCount },
    },
    taskFindMany,
    onsiteFindMany,
    ticketFindMany,
    notificationFindMany,
  };
}

describe('görev ve onsite şirket kapsamı', () => {
  it('it_manager görevlerin tümü görünümünde yalnızca kendi şirket kapsamını sorgular', async () => {
    const { prisma, taskFindMany } = scopedPrisma();
    const app = buildTestApp(prisma);
    const { taskRoutes } = await import('../../src/modules/tasks/tasks.routes.js');
    app.register(taskRoutes, { prefix: '/tasks' });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/tasks?scope=all',
      headers: authHeader(StaffRole.it_manager, MANAGER_ID),
    });

    expect(response.statusCode).toBe(200);
    expect(taskFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { location: { companyId: { in: [COMPANY_ID] } } },
        ]),
      }),
    }));
  });

  it('it_staff görev oluşturamaz', async () => {
    const { prisma } = scopedPrisma();
    const app = buildTestApp(prisma);
    const { taskRoutes } = await import('../../src/modules/tasks/tasks.routes.js');
    app.register(taskRoutes, { prefix: '/tasks' });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: authHeader(StaffRole.it_staff),
      payload: {},
    });

    expect(response.statusCode).toBe(403);
  });

  it('it_manager onsite listesini ticket şirket kapsamıyla sınırlar', async () => {
    const { prisma, onsiteFindMany } = scopedPrisma();
    const app = buildTestApp(prisma);
    const { onsiteRoutes } = await import('../../src/modules/onsite-support/onsite.routes.js');
    app.register(onsiteRoutes, { prefix: '/onsite-support' });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/onsite-support',
      headers: authHeader(StaffRole.it_manager, MANAGER_ID),
    });

    expect(response.statusCode).toBe(200);
    expect(onsiteFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ticket: { companyId: { in: [COMPANY_ID] } } },
    }));
  });

  it('it_manager kapsam dışı şirket filtresiyle rapor verisi okuyamaz', async () => {
    const { prisma, ticketFindMany } = scopedPrisma();
    ticketFindMany.mockResolvedValueOnce([{
      id: 'ticket-1', ticketNumber: 'TKT-2026-00001', subject: 'Yazıcı', status: 'open',
      priority: 'medium', createdByEmail: 'user@example.com', createdAt: new Date(),
      resolvedAt: null, slaResponseMet: null, slaResolveMet: null,
      accessToken: 'public-bearer-secret', company: { name: 'ACME' }, location: { name: 'Merkez' },
      category: { name: 'Donanım' }, assignedTo: null,
    }]);
    const app = buildTestApp(prisma);
    const { reportRoutes } = await import('../../src/modules/reports/reports.routes.js');
    app.register(reportRoutes, { prefix: '/reports' });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/reports/tickets?companyId=other-company',
      headers: authHeader(StaffRole.it_manager, MANAGER_ID),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data[0]).not.toHaveProperty('accessToken');
    expect(ticketFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyId: { in: [] } },
    }));
  });

  it('it_staff şablonları yönetemez, it_manager yeni e-posta şablonu oluşturamaz', async () => {
    const { prisma } = scopedPrisma();
    const app = buildTestApp(prisma);
    const { templateRoutes } = await import('../../src/modules/templates/templates.routes.js');
    app.register(templateRoutes, { prefix: '/templates' });
    await app.ready();

    const listResponse = await app.inject({
      method: 'GET',
      url: '/templates/email',
      headers: authHeader(StaffRole.it_staff),
    });
    const createResponse = await app.inject({
      method: 'POST',
      url: '/templates/email',
      headers: authHeader(StaffRole.it_manager, MANAGER_ID),
      payload: {},
    });

    expect(listResponse.statusCode).toBe(403);
    expect(createResponse.statusCode).toBe(403);
  });

  it('it_manager bildirim listesini ticket şirket kapsamıyla sınırlar', async () => {
    const { prisma, notificationFindMany } = scopedPrisma();
    const app = buildTestApp(prisma);
    const { notificationRoutes } = await import('../../src/modules/notifications/notifications.routes.js');
    app.register(notificationRoutes, { prefix: '/notifications' });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/notifications',
      headers: authHeader(StaffRole.it_manager, MANAGER_ID),
    });

    expect(response.statusCode).toBe(200);
    expect(notificationFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ticket: { companyId: { in: [COMPANY_ID] } } },
    }));
  });

  it('dashboard bana atananlar cevabı public accessToken yayınlamaz', async () => {
    const { prisma, ticketFindMany } = scopedPrisma();
    ticketFindMany.mockResolvedValueOnce([{
      id: 'ticket-1',
      ticketNumber: 'TKT-2026-00001',
      subject: 'Yazıcı',
      status: 'open',
      priority: 'medium',
      createdByEmail: 'user@example.com',
      createdAt: new Date('2026-07-16T10:00:00Z'),
      updatedAt: new Date('2026-07-16T10:00:00Z'),
      accessToken: 'public-bearer-secret',
      company: { name: 'ACME' },
      category: { name: 'Donanım' },
    }]);
    const app = buildTestApp(prisma);
    const { dashboardRoutes } = await import('../../src/modules/dashboard/dashboard.routes.js');
    app.register(dashboardRoutes, { prefix: '/dashboard' });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/dashboard/my-tickets',
      headers: authHeader(StaffRole.it_manager, MANAGER_ID),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data[0]).not.toHaveProperty('accessToken');
  });
});
