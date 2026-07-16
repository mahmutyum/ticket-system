import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StaffRole } from '@prisma/client';
import { buildTestApp, authHeader } from '../helpers/app.js';

/**
 * `PUT /tickets/:id` ve `POST /tickets/:id/attachments` — şirket kapsamı.
 *
 * `GET /tickets/:id` kapsamı kontrol ediyordu, bu iki uç ETMİYORDU. Yani kapsam
 * dışı bir ticket okunamıyor ama id'si bilindiğinde:
 *   - durumu/önceliği değiştirilebiliyor, başkasına atanabiliyordu,
 *   - üzerine dosya eklenebiliyordu — ve o dosya ticket'ın public takip
 *     linkinden talep edene servis ediliyor.
 *
 * Yazma yetkisi okuma yetkisinden geniş olamaz.
 */

vi.mock('../../src/db.js', () => ({
  prisma: { auditLog: { create: vi.fn() } },
}));
vi.mock('../../src/jobs/queue.js', () => ({
  queueEmail: vi.fn(),
  queueSms: vi.fn(),
  redisConnection: { eval: vi.fn(async () => 1) },
}));
vi.mock('../../src/services/sse.service.js', () => ({
  broadcastToStaff: vi.fn(),
  broadcastToTicket: vi.fn(),
}));
// Bu dosya kapsamı ve kotayı test ediyor, diske yazmayı değil. Gerçek saveFile
// `UPLOAD_DIR`'e (production'da /app/uploads) yazmaya çalışıp ENOENT verirdi.
// Uzantı/MIME davranışı storage.test.ts'te gerçek dosya sistemine karşı test ediliyor.
vi.mock('../../src/services/storage.service.js', () => ({
  isAllowedMimeType: () => true,
  saveFile: vi.fn(async (buffer: Buffer) => ({
    fileName: 'a.txt',
    filePath: 'ticket/a.txt',
    fileSize: buffer.length,
  })),
}));

const MANAGER_ID = 'clmanagerxxxxxxxxxxxxxxxx';
const TICKET_ID = 'clticketxxxxxxxxxxxxxxxxx';
const IN_SCOPE = 'clcompanyinscopexxxxxxxxx';
const OUT_OF_SCOPE = 'clcompanyoutofscopexxxxxx';

/** it_manager yalnızca IN_SCOPE'a atanmış. */
function makeApp(ticketCompanyId: string) {
  const ticketUpdate = vi.fn(async () => ({
    id: TICKET_ID,
    ticketNumber: 'TKT-2026-00001',
    accessToken: 'public-bearer-secret',
    accessTokenExpiresAt: null,
  }));
  const attachmentCreate = vi.fn(async () => ({ id: 'att1', filePath: 'ticket/a.txt' }));

  const prisma = {
    staffCompany: {
      findMany: vi.fn(async () => [{ companyId: IN_SCOPE }]),
    },
    ticket: {
      findUnique: vi.fn(async () => ({
        id: TICKET_ID,
        companyId: ticketCompanyId,
        status: 'open',
        priority: 'medium',
        ticketNumber: 'TKT-2026-00001',
        subject: 'test',
        createdByEmail: 'a@b.co',
        accessToken: 'public-bearer-secret',
        accessTokenExpiresAt: null,
        firstRespondedAt: null,
        slaResponseDue: null,
        slaResolveDue: null,
        company: { name: 'Test' },
        createdBy: null,
        attachments: [{ id: 'att1', filePath: 'ticket/a.txt', fileName: 'a.txt' }],
      })),
      update: ticketUpdate,
    },
    ticketHistory: { create: vi.fn(), createMany: vi.fn() },
    attachment: {
      // Dönüş tipi açıkça yazılır: aksi halde ilk değerden çıkarılır ve testler
      // `fileSize: null` (Prisma'nın boş toplamı) veremez.
      aggregate: vi.fn(
        async (): Promise<{ _count: number; _sum: { fileSize: number | null } }> => ({
          _count: 0,
          _sum: { fileSize: 0 },
        }),
      ),
      create: attachmentCreate,
    },
    $transaction: vi.fn(async (ops: unknown) =>
      Array.isArray(ops) ? Promise.all(ops as Promise<unknown>[]) : ops,
    ),
  };

  const app = buildTestApp(prisma);
  return { app, prisma, ticketUpdate, attachmentCreate };
}

async function withRoutes(app: any) {
  // Ek yükleme ucu multipart gövde bekliyor; plugin olmadan fastify isteği
  // handler'a hiç sokmadan 415 döner ve kapsam kontrolü test edilmemiş olur.
  const multipart = (await import('@fastify/multipart')).default;
  await app.register(multipart);
  const { ticketRoutes } = await import('../../src/modules/tickets/tickets.routes.js');
  app.register(ticketRoutes, { prefix: '/tickets' });
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /tickets/:id — cevap veri sınırı', () => {
  it('public erişim sırrını ve depolama yolunu personele yayınlamaz', async () => {
    const { app } = makeApp(IN_SCOPE);
    await withRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: `/tickets/${TICKET_ID}`,
      headers: authHeader(StaffRole.it_manager, MANAGER_ID),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).not.toHaveProperty('accessToken');
    expect(res.json().data).not.toHaveProperty('accessTokenExpiresAt');
    expect(res.json().data.attachments[0]).not.toHaveProperty('filePath');
  });
});

describe('PUT /tickets/:id — şirket kapsamı', () => {
  it('kapsam DIŞI ticket 403 — ve DB\'ye yazılmaz', async () => {
    const { app, ticketUpdate } = makeApp(OUT_OF_SCOPE);
    await withRoutes(app);

    const res = await app.inject({
      method: 'PUT',
      url: `/tickets/${TICKET_ID}`,
      headers: authHeader(StaffRole.it_manager, MANAGER_ID),
      payload: { status: 'in_progress' },
    });

    expect(res.statusCode).toBe(403);
    // Asıl kanıt: reddedilmesi yetmez, yazma HİÇ olmamalı.
    expect(ticketUpdate).not.toHaveBeenCalled();
  });

  it('kapsam İÇİ ticket güncellenebilir', async () => {
    const { app, ticketUpdate } = makeApp(IN_SCOPE);
    await withRoutes(app);

    const res = await app.inject({
      method: 'PUT',
      url: `/tickets/${TICKET_ID}`,
      headers: authHeader(StaffRole.it_manager, MANAGER_ID),
      payload: { status: 'in_progress' },
    });

    expect(res.statusCode).toBe(200);
    expect(ticketUpdate).toHaveBeenCalled();
    expect(res.json().data).not.toHaveProperty('accessToken');
    expect(res.json().data).not.toHaveProperty('accessTokenExpiresAt');
  });

  it('admin her ticket\'ı güncelleyebilir', async () => {
    const { app, ticketUpdate } = makeApp(OUT_OF_SCOPE);
    await withRoutes(app);

    const res = await app.inject({
      method: 'PUT',
      url: `/tickets/${TICKET_ID}`,
      headers: authHeader(StaffRole.admin, 'cladminxxxxxxxxxxxxxxxxxx'),
      payload: { status: 'in_progress' },
    });

    expect(res.statusCode).toBe(200);
    expect(ticketUpdate).toHaveBeenCalled();
  });

  it('hiç şirkete atanmamış it_manager 403 (fail-closed)', async () => {
    const { app, prisma, ticketUpdate } = makeApp(IN_SCOPE);
    prisma.staffCompany.findMany = vi.fn(async () => []);
    await withRoutes(app);

    const res = await app.inject({
      method: 'PUT',
      url: `/tickets/${TICKET_ID}`,
      headers: authHeader(StaffRole.it_manager, MANAGER_ID),
      payload: { status: 'in_progress' },
    });

    expect(res.statusCode).toBe(403);
    expect(ticketUpdate).not.toHaveBeenCalled();
  });
});

/** `file` alanlı geçerli bir multipart gövdesi. */
function upload(app: any, role: StaffRole = StaffRole.it_manager, id = MANAGER_ID) {
  return app.inject({
    method: 'POST',
    url: `/tickets/${TICKET_ID}/attachments`,
    headers: {
      ...authHeader(role, id),
      'content-type': 'multipart/form-data; boundary=----x',
    },
    payload:
      '------x\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\n' +
      'Content-Type: text/plain\r\n\r\nmerhaba\r\n------x--\r\n',
  });
}

describe('POST /tickets/:id/attachments — şirket kapsamı', () => {
  it('kapsam DIŞI ticket\'a dosya eklenemez', async () => {
    const { app, attachmentCreate } = makeApp(OUT_OF_SCOPE);
    await withRoutes(app);

    const res = await upload(app);

    expect(res.statusCode).toBe(403);
    expect(attachmentCreate).not.toHaveBeenCalled();
  });
});

/**
 * Ticket başına ek kotası.
 *
 * Dosya başına 25 MB sınırı vardı ama toplam yoktu: aynı ticket'a sınırsız ek
 * yüklenip disk şişirilebiliyordu.
 */
describe('POST /tickets/:id/attachments — kota', () => {
  it('adet sınırına ulaşıldıysa reddeder', async () => {
    const { app, prisma, attachmentCreate } = makeApp(IN_SCOPE);
    prisma.attachment.aggregate = vi.fn(async () => ({ _count: 20, _sum: { fileSize: 100 } }));
    await withRoutes(app);

    const res = await upload(app);

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/en fazla 20 dosya/);
    expect(attachmentCreate).not.toHaveBeenCalled();
  });

  it('toplam boyut sınırını aşarsa reddeder', async () => {
    const { app, prisma, attachmentCreate } = makeApp(IN_SCOPE);
    // Kotanın hemen altında: bir bayt daha sığmaz.
    prisma.attachment.aggregate = vi.fn(async () => ({
      _count: 1,
      _sum: { fileSize: 200 * 1024 * 1024 },
    }));
    await withRoutes(app);

    const res = await upload(app);

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/toplam ek boyutu 200 MB/);
    expect(attachmentCreate).not.toHaveBeenCalled();
  });

  it('kota içindeyse yükleme geçer', async () => {
    const { app, attachmentCreate } = makeApp(IN_SCOPE);
    await withRoutes(app);

    const res = await upload(app);

    expect(res.statusCode).toBe(201);
    expect(attachmentCreate).toHaveBeenCalled();
    expect(res.json().data).not.toHaveProperty('filePath');
  });

  it('ilk ek — Prisma\'nın null toplamı yüklemeyi engellemez', async () => {
    // Prisma hiç kayıt yokken `_sum.fileSize = NULL` döner. Bu yol en sık
    // çalışan yol (her ticket'ın ilk eki) ve kotanın onu yanlışlıkla
    // reddetmediğini doğrular.
    //
    // Not: koddaki `?? 0` savunma amaçlıdır, taşıyıcı değil — JS'te
    // `null + n === n` ve null toplam yalnızca `_count === 0` iken görülür,
    // yani o durumda kota zaten aşılamaz. `?? 0`'ı silmek bu testi kırmaz;
    // niyeti açık tutmak için duruyor.
    const { app, prisma, attachmentCreate } = makeApp(IN_SCOPE);
    prisma.attachment.aggregate = vi.fn(async () => ({ _count: 0, _sum: { fileSize: null } }));
    await withRoutes(app);

    const res = await upload(app);

    expect(res.statusCode).toBe(201);
    expect(attachmentCreate).toHaveBeenCalled();
  });
});
