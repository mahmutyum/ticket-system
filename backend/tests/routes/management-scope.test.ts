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
  const ticketFindMany = vi.fn(async () => []);
  const ticketCount = vi.fn(async () => 0);
  return {
    prisma: {
      staffCompany: { findMany: vi.fn(async () => [{ companyId: COMPANY_ID }]) },
      task: { findMany: taskFindMany },
      onsiteSupport: { findMany: onsiteFindMany },
      ticket: { findMany: ticketFindMany, count: ticketCount },
    },
    taskFindMany,
    onsiteFindMany,
    ticketFindMany,
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
});
