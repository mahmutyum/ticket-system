import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StaffRole } from '@prisma/client';
import { buildTestApp, authHeader, scopeStub } from '../helpers/app.js';
import { encrypt } from '../../src/utils/crypto.js';

/**
 * Şifre kasası — route seviyesinde yetkilendirme.
 *
 * Birim testleri (staff-scope.test.ts) kapsam MANTIĞINI doğrular; buradaki
 * testler o mantığın endpoint'lerde gerçekten ÇAĞRILDIĞINI doğrular. İkisi
 * farklı şeydir: `requireRole` doğru olabilir ama handler kapsam kontrolünü
 * atlarsa kasa yine sızar.
 *
 * Kasa en hassas modüldür — `reveal` çözülmüş şifre döndürür.
 */

// createAuditLog paylaşılan `db.js` prisma'sını kullanır (app.prisma değil).
const auditCreate = vi.fn();
vi.mock('../../src/db.js', () => ({
  prisma: { auditLog: { create: (...a: any[]) => auditCreate(...a) } },
}));

const ENTRY_MINE = { id: 'c-mine', companyId: 'co-1', title: 'Kendi şirketim', passwordEnc: encrypt('s1'), notesEnc: null };
const ENTRY_OTHER = { id: 'c-other', companyId: 'co-9', title: 'Başka şirket', passwordEnc: encrypt('s2'), notesEnc: null };
const ENTRY_GLOBAL = { id: 'c-global', companyId: null, title: 'Global sır', passwordEnc: encrypt('s3'), notesEnc: null };

const ENTRIES: Record<string, any> = {
  'c-mine': ENTRY_MINE,
  'c-other': ENTRY_OTHER,
  'c-global': ENTRY_GLOBAL,
};

/** it_manager 'co-1'e atanmış; 'co-9' ve global kapsam dışı. */
function makeApp(scope: string[]) {
  // Argüman tipi açıkça verilir — `vi.fn(async () => [])` çağrıyı argümansız
  // çıkarır ve `mock.calls[0][0]` tip hatası olur.
  const findMany = vi.fn<(args: { where: unknown }) => Promise<unknown[]>>(async () => []);
  const prisma = {
    staffCompany: scopeStub(scope),
    credentialEntry: {
      findMany,
      findUnique: async ({ where }: any) => ENTRIES[where.id] ?? null,
      create: async ({ data }: any) => ({ id: 'new', title: data.title }),
      update: async ({ where }: any) => ({ id: where.id, title: 'x' }),
      delete: async () => ({}),
    },
  };
  const app = buildTestApp(prisma);
  return { app, prisma, findMany };
}

async function withRoutes(app: any) {
  const { credentialRoutes } = await import('../../src/modules/credentials/credentials.routes.js');
  app.register(credentialRoutes, { prefix: '/credentials' });
  await app.ready();
  return app;
}

beforeEach(() => auditCreate.mockClear());

describe('GET /credentials — erişim', () => {
  it('token yoksa 401', async () => {
    const { app } = makeApp(['co-1']);
    await withRoutes(app);
    const res = await app.inject({ method: 'GET', url: '/credentials' });
    expect(res.statusCode).toBe(401);
  });

  it('it_staff 403 alır — kasa ona kapalı', async () => {
    const { app } = makeApp(['co-1']);
    await withRoutes(app);
    const res = await app.inject({ method: 'GET', url: '/credentials', headers: authHeader(StaffRole.it_staff) });
    expect(res.statusCode).toBe(403);
  });

  it('it_manager listeyi YALNIZCA kendi şirketleriyle sınırlı sorgular', async () => {
    const { app, findMany } = makeApp(['co-1', 'co-2']);
    await withRoutes(app);
    const res = await app.inject({ method: 'GET', url: '/credentials', headers: authHeader(StaffRole.it_manager) });
    expect(res.statusCode).toBe(200);
    expect(findMany.mock.calls[0][0].where).toEqual({ companyId: { in: ['co-1', 'co-2'] } });
  });

  it('it_manager kapsam DIŞI companyId isterse hiçbir kayıt eşleşmez', async () => {
    // Regresyon: ?companyId=<başka-şirket> ile kapsam aşılabiliyordu.
    const { app, findMany } = makeApp(['co-1']);
    await withRoutes(app);
    await app.inject({ method: 'GET', url: '/credentials?companyId=co-9', headers: authHeader(StaffRole.it_manager) });
    expect(findMany.mock.calls[0][0].where).toEqual({ companyId: { in: [] } });
  });

  it('admin kısıtsız sorgular', async () => {
    const { app, findMany } = makeApp([]);
    await withRoutes(app);
    await app.inject({ method: 'GET', url: '/credentials', headers: authHeader(StaffRole.admin) });
    expect(findMany.mock.calls[0][0].where).toEqual({});
  });

  it('veri katmanı döndürse bile liste şifreli parola ve not alanlarını yayınlamaz', async () => {
    const { app, findMany } = makeApp([]);
    findMany.mockResolvedValueOnce([{
      id: 'c1',
      title: 'Sunucu',
      category: null,
      url: null,
      username: null,
      companyId: null,
      passwordEnc: 'encrypted-password',
      notesEnc: 'encrypted-note',
      createdAt: new Date('2026-07-16T10:00:00Z'),
      updatedAt: new Date('2026-07-16T10:00:00Z'),
      company: null,
    }]);
    await withRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/credentials',
      headers: authHeader(StaffRole.admin),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data[0]).not.toHaveProperty('passwordEnc');
    expect(res.json().data[0]).not.toHaveProperty('notesEnc');
  });
});

describe('GET /credentials/:id/reveal — şifre çözme', () => {
  it('it_manager kendi şirketinin şifresini görebilir', async () => {
    const { app } = makeApp(['co-1']);
    await withRoutes(app);
    const res = await app.inject({ method: 'GET', url: '/credentials/c-mine/reveal', headers: authHeader(StaffRole.it_manager) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.password).toBe('s1');
  });

  it('it_manager BAŞKA şirketin şifresini göremez', async () => {
    const { app } = makeApp(['co-1']);
    await withRoutes(app);
    const res = await app.inject({ method: 'GET', url: '/credentials/c-other/reveal', headers: authHeader(StaffRole.it_manager) });
    expect(res.statusCode).toBe(403);
    expect(res.payload).not.toContain('s2');
  });

  it('it_manager GLOBAL (companyId=null) şifreyi göremez', async () => {
    const { app } = makeApp(['co-1']);
    await withRoutes(app);
    const res = await app.inject({ method: 'GET', url: '/credentials/c-global/reveal', headers: authHeader(StaffRole.it_manager) });
    expect(res.statusCode).toBe(403);
    expect(res.payload).not.toContain('s3');
  });

  it('admin global şifreyi görebilir', async () => {
    const { app } = makeApp([]);
    await withRoutes(app);
    const res = await app.inject({ method: 'GET', url: '/credentials/c-global/reveal', headers: authHeader(StaffRole.admin) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.password).toBe('s3');
  });

  it('REDDEDİLEN görüntüleme audit log YAZMAZ', async () => {
    // Kontrol audit log'dan ÖNCE yapılmalı; sonra yapılırsa başarısız bir deneme
    // başarılı bir görüntüleme gibi kaydedilir ve log yanıltıcı olur.
    const { app } = makeApp(['co-1']);
    await withRoutes(app);
    await app.inject({ method: 'GET', url: '/credentials/c-other/reveal', headers: authHeader(StaffRole.it_manager) });
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('başarılı görüntüleme audit log YAZAR', async () => {
    const { app } = makeApp(['co-1']);
    await withRoutes(app);
    await app.inject({ method: 'GET', url: '/credentials/c-mine/reveal', headers: authHeader(StaffRole.it_manager) });
    expect(auditCreate).toHaveBeenCalledOnce();
    expect(auditCreate.mock.calls[0][0].data.action).toBe('credential_reveal');
  });
});

describe('POST /credentials — oluşturma', () => {
  it('it_manager şirketsiz (global) kayıt oluşturamaz', async () => {
    const { app } = makeApp(['co-1']);
    await withRoutes(app);
    const res = await app.inject({
      method: 'POST', url: '/credentials', headers: authHeader(StaffRole.it_manager),
      payload: { title: 'x', password: 'p' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('it_manager kapsam dışı şirkete kayıt oluşturamaz', async () => {
    const { app } = makeApp(['co-1']);
    await withRoutes(app);
    const res = await app.inject({
      method: 'POST', url: '/credentials', headers: authHeader(StaffRole.it_manager),
      payload: { title: 'x', password: 'p', companyId: 'clxxxxxxxxxxxxxxxxxxxxxxx' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('admin global kayıt oluşturabilir', async () => {
    const { app } = makeApp([]);
    await withRoutes(app);
    const res = await app.inject({
      method: 'POST', url: '/credentials', headers: authHeader(StaffRole.admin),
      payload: { title: 'x', password: 'p' },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('PUT /credentials/:id — güncelleme', () => {
  it('it_manager kapsam dışı kaydı düzenleyemez', async () => {
    const { app } = makeApp(['co-1']);
    await withRoutes(app);
    const res = await app.inject({
      method: 'PUT', url: '/credentials/c-other', headers: authHeader(StaffRole.it_manager),
      payload: { title: 'ele geçir' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('it_manager kaydı kapsam dışı bir şirkete TAŞIYAMAZ', async () => {
    // Hedef şirket kontrol edilmezse kayıt kendi kapsamına çekilip okunabilirdi.
    const { app } = makeApp(['co-1']);
    await withRoutes(app);
    const res = await app.inject({
      method: 'PUT', url: '/credentials/c-mine', headers: authHeader(StaffRole.it_manager),
      payload: { companyId: 'clyyyyyyyyyyyyyyyyyyyyyyy' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /credentials/:id', () => {
  it('it_manager kapsam dışı kaydı silemez', async () => {
    const { app } = makeApp(['co-1']);
    await withRoutes(app);
    const res = await app.inject({ method: 'DELETE', url: '/credentials/c-other', headers: authHeader(StaffRole.it_manager) });
    expect(res.statusCode).toBe(403);
  });
});
