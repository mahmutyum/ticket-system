import { describe, it, expect, vi } from 'vitest';
import { StaffRole } from '@prisma/client';
import { buildTestApp, authHeader, scopeStub } from '../helpers/app.js';

vi.mock('../../src/middleware/audit.js', () => ({ createAuditLog: vi.fn(async () => undefined) }));
const { kbRoutes, kbPublicRoutes, excerpt } = await import('../../src/modules/kb/kb.routes.js');

const body = { titleTr: 'VPN kurulumu', bodyTr: '# Adımlar\n1. İndir', isPublished: true };

function makeApp(existing: Record<string, unknown> | null = null) {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'a1', viewCount: 0, helpfulYes: 0, helpfulNo: 0, deflections: 0, createdAt: new Date(), updatedAt: new Date(),
    titleEn: null, bodyEn: null, categoryId: null, company: null, category: null, createdBy: 'x', ...data,
  }));
  const findMany = vi.fn(async () => []);
  const prisma = {
    staffCompany: scopeStub(['co-in']),
    kbArticle: { create, findUnique: vi.fn(async () => existing), findMany, findFirst: vi.fn(async () => null), update: vi.fn(), delete: vi.fn() },
    category: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === 'cat-other' ? { companyId: 'co-out' } : { companyId: null })) },
    company: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ isActive: where.id !== 'co-inactive' })) },
  };
  const app = buildTestApp(prisma);
  app.setErrorHandler((err: { statusCode?: number; message: string }, _req, reply) => {
    reply.status(err.statusCode ?? 500).send({ success: false, error: err.message });
  });
  app.register(kbRoutes, { prefix: '/kb' });
  app.register(kbPublicRoutes, { prefix: '/public/kb' });
  return { app, create, findMany, prisma };
}

describe('KB yazma yetkisi', () => {
  it('it_manager global makale yazamaz, kendi şirketine yazabilir', async () => {
    const { app, create } = makeApp();
    const global = await app.inject({ method: 'POST', url: '/kb', headers: authHeader(StaffRole.it_manager), payload: body });
    expect(global.statusCode).toBe(403);
    const own = await app.inject({ method: 'POST', url: '/kb', headers: authHeader(StaffRole.it_manager), payload: { ...body, companyId: 'co-in' } });
    expect(own.statusCode, own.body).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('kapsam dışı şirkete yazamaz; başka şirketin kategorisi bağlanamaz', async () => {
    const { app, create } = makeApp();
    expect((await app.inject({ method: 'POST', url: '/kb', headers: authHeader(StaffRole.it_manager), payload: { ...body, companyId: 'co-out' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/kb', headers: authHeader(StaffRole.admin), payload: { ...body, companyId: 'co-in', categoryId: 'cat-other' } })).statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('it_staff makale yazamaz', async () => {
    const { app } = makeApp();
    expect((await app.inject({ method: 'POST', url: '/kb', headers: authHeader(StaffRole.it_staff), payload: { ...body, companyId: 'co-in' } })).statusCode).toBe(403);
  });

  it('başka şirketin makalesi güncellenemez (taşıma dahil)', async () => {
    const { app } = makeApp({ id: 'a1', companyId: 'co-out' });
    const res = await app.inject({ method: 'PUT', url: '/kb/a1', headers: authHeader(StaffRole.it_manager), payload: { ...body, companyId: 'co-in' } });
    expect(res.statusCode).toBe(403);
  });
});

describe('KB public', () => {
  it('yalnızca yayındakiler ve (aktif) portal şirketi + global', async () => {
    const { app, findMany } = makeApp();
    await app.inject({ method: 'GET', url: '/public/kb?companyId=co-in&q=vpn' });
    const where = (findMany.mock.calls[0] as unknown as [{ where: { AND: unknown[] } }])[0].where.AND;
    expect(where[0]).toEqual({ isPublished: true });
    expect(where[1]).toEqual({ OR: [{ companyId: 'co-in' }, { companyId: null }] });

    await app.inject({ method: 'GET', url: '/public/kb?companyId=co-inactive' });
    const inactive = (findMany.mock.calls[1] as unknown as [{ where: { AND: unknown[] } }])[0].where.AND;
    expect(inactive[1]).toEqual({ companyId: null });
  });

  it('özet Markdown sözdizimini ayıklar', () => {
    expect(excerpt('# Başlık\n\n**Kalın** [bağlantı](http://x) `kod`')).toBe('Başlık Kalın bağlantı kod');
  });
});
