import { describe, it, expect, vi } from 'vitest';
import { buildTestApp } from '../helpers/app.js';

/**
 * Public ticket uç noktası — iç veri sızıntısı.
 *
 * `notes: { where: { isInternal: false } }` filtresi doğru ama TEK BAŞINA
 * yetmiyordu: her not için `ticket_history`'ye de bir satır yazılıyor ve o ilişki
 * filtrelenmediği için iç notlar `history[].newValue` üzerinden public'e
 * sızıyordu. Link'i olan herkes her iç notun ilk 100 karakterini okuyabiliyordu.
 *
 * Bu testler iki savunma katmanını da tutar:
 *  1. public sorgu `internal_note_added` kayıtlarını dışlar,
 *  2. iç notların metni history'ye hiç yazılmaz.
 */

vi.mock('../../src/db.js', () => ({ prisma: { auditLog: { create: vi.fn() } } }));

// jobs/queue.js import anında BullMQ Queue kurar ve Redis'e bağlanır — testler
// gerçek altyapıya bağlanmaz.
vi.mock('../../src/jobs/queue.js', () => ({
  queueEmail: vi.fn(async () => {}),
  queueSms: vi.fn(async () => {}),
}));

const TICKET = {
  id: 't1',
  ticketNumber: 'TKT-2026-00001',
  subject: 'Yazıcı',
  status: 'open',
  companyId: 'co-1',
  accessToken: 'tok',
  createdByEmail: 'user@co.com',
  notes: [],
  history: [],
  attachments: [],
  customValues: [],
  onsiteSupport: [],
};

function makeApp() {
  const findUnique = vi.fn<(args: any) => Promise<any>>(async () => TICKET);
  const prisma = { ticket: { findUnique } };
  return { app: buildTestApp(prisma), findUnique };
}

async function withRoutes(app: any) {
  const { publicRoutes } = await import('../../src/modules/tickets/public.routes.js');
  app.register(publicRoutes, { prefix: '/public' });
  await app.ready();
  return app;
}

describe('GET /public/ticket/:accessToken — iç veri sızıntısı', () => {
  it('history sorgusu internal_note_added kayıtlarını DIŞLAR', async () => {
    const { app, findUnique } = makeApp();
    await withRoutes(app);

    const res = await app.inject({ method: 'GET', url: '/public/ticket/tok' });
    expect(res.statusCode).toBe(200);

    const select = findUnique.mock.calls[0][0].select ?? findUnique.mock.calls[0][0].include;
    expect(select.history.where).toEqual({ action: { not: 'internal_note_added' } });
  });

  it('notes sorgusu yalnızca public notları ister', async () => {
    const { app, findUnique } = makeApp();
    await withRoutes(app);
    await app.inject({ method: 'GET', url: '/public/ticket/tok' });

    const select = findUnique.mock.calls[0][0].select ?? findUnique.mock.calls[0][0].include;
    expect(select.notes.where).toEqual({ isInternal: false });
  });
});

describe('POST /tickets/:ticketId/notes — iç not metni history\'ye yazılmaz', () => {
  it('iç notta newValue null olur', async () => {
    const historyCreate = vi.fn<(args: { data: Record<string, unknown> }) => Promise<unknown>>(async () => ({}));
    const prisma = {
      ticket: {
        findUnique: async () => ({
          id: 't1', ticketNumber: 'TKT-1', createdByEmail: 'u@c.com',
          accessToken: 'tok', companyId: 'co-1', assignedTo: null,
        }),
      },
      ticketNote: { create: async () => ({ id: 'n1', createdBy: { fullName: 'IT' } }) },
      ticketHistory: { create: historyCreate },
      staffCompany: { findMany: async () => [{ companyId: 'co-1' }] },
    };
    const app = buildTestApp(prisma);
    const { noteRoutes } = await import('../../src/modules/notes/notes.routes.js');
    app.register(noteRoutes, { prefix: '/tickets' });
    await app.ready();

    const { StaffRole } = await import('@prisma/client');
    const { authHeader } = await import('../helpers/app.js');

    await app.inject({
      method: 'POST', url: '/tickets/t1/notes',
      headers: authHeader(StaffRole.admin),
      payload: { content: 'Kullanıcı yalan söylüyor, AD loglarına bak', isInternal: true },
    });

    expect(historyCreate).toHaveBeenCalled();
    const data = historyCreate.mock.calls[0][0].data;
    expect(data.action).toBe('internal_note_added');
    // Regresyon: burada notun metni vardı.
    expect(data.newValue).toBeNull();
  });

  it('public notta önizleme yazılmaya devam eder', async () => {
    const historyCreate = vi.fn<(args: { data: Record<string, unknown> }) => Promise<unknown>>(async () => ({}));
    const prisma = {
      ticket: {
        findUnique: async () => ({
          id: 't1', ticketNumber: 'TKT-1', createdByEmail: 'u@c.com',
          accessToken: 'tok', companyId: 'co-1', assignedTo: null,
        }),
      },
      ticketNote: { create: async () => ({ id: 'n1', createdBy: { fullName: 'IT' } }) },
      ticketHistory: { create: historyCreate },
      staffCompany: { findMany: async () => [{ companyId: 'co-1' }] },
    };
    const app = buildTestApp(prisma);
    const { noteRoutes } = await import('../../src/modules/notes/notes.routes.js');
    app.register(noteRoutes, { prefix: '/tickets' });
    await app.ready();

    const { StaffRole } = await import('@prisma/client');
    const { authHeader } = await import('../helpers/app.js');

    await app.inject({
      method: 'POST', url: '/tickets/t1/notes',
      headers: authHeader(StaffRole.admin),
      payload: { content: 'Cihazınız hazır', isInternal: false },
    });

    const data = historyCreate.mock.calls[0][0].data;
    expect(data.action).toBe('note_added');
    expect(data.newValue).toBe('Cihazınız hazır');
  });
});
