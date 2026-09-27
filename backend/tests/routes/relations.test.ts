import { describe, it, expect, vi } from 'vitest';
import { StaffRole } from '@prisma/client';
import { buildTestApp, authHeader } from '../helpers/app.js';
import { mergeError, normalizeCc, parentError, type RelationTicket } from '../../src/services/ticket-relations.js';

vi.mock('../../src/jobs/queue.js', () => ({ queueEmail: vi.fn(async () => {}), queueSms: vi.fn(async () => {}) }));
const { relationRoutes } = await import('../../src/modules/tickets/relations.routes.js');

const rt = (o: Partial<RelationTicket> = {}): RelationTicket => ({
  id: 'a', companyId: 'co-1', status: 'open', parentId: null, mergedIntoId: null, ...o,
});

describe('mergeError / parentError', () => {
  it('birleştirme kuralları', () => {
    expect(mergeError(rt(), rt())).toBe('tickets.merge_self');
    expect(mergeError(rt(), rt({ id: 'b', companyId: 'co-2' }))).toBe('tickets.merge_other_company');
    expect(mergeError(rt({ mergedIntoId: 'x' }), rt({ id: 'b' }))).toBe('tickets.merge_already_merged');
    expect(mergeError(rt(), rt({ id: 'b', mergedIntoId: 'x' }))).toBe('tickets.merge_target_merged');
    expect(mergeError(rt(), rt({ id: 'b', status: 'closed' }))).toBe('tickets.merge_target_closed');
    expect(mergeError(rt(), rt({ id: 'b', status: 'resolved' }))).toBeNull();
  });

  it('tek seviyeli hiyerarşi — döngü imkânsız', () => {
    expect(parentError(rt(), rt(), false)).toBe('tickets.parent_self');
    expect(parentError(rt(), rt({ id: 'p', parentId: 'pp' }), false)).toBe('tickets.parent_is_child');
    expect(parentError(rt(), rt({ id: 'p' }), true)).toBe('tickets.parent_child_has_children');
    expect(parentError(rt(), rt({ id: 'p', companyId: 'co-2' }), false)).toBe('tickets.parent_other_company');
    expect(parentError(rt(), rt({ id: 'p' }), false)).toBeNull();
  });

  it('CC normalizasyonu: küçük harf, tekil, hariç tutma, üst sınır', () => {
    expect(normalizeCc(['A@x.com', 'a@x.com', 'req@x.com', 'b@x.com'], ['REQ@x.com'], 2)).toEqual(['a@x.com', 'b@x.com']);
  });
});

type Row = Record<string, unknown>;

function ticketRow(o: Row = {}): Row {
  return {
    id: 'src', ticketNumber: 'TKT-2026-00001', companyId: 'co-1', status: 'open', parentId: null, mergedIntoId: null,
    createdByEmail: 'a@acme.com', accessToken: 'tok-src', locale: 'tr', priority: 'medium',
    firstRespondedAt: null, resolvedAt: null, slaResponseDue: null, slaResolveDue: null, slaResponseMet: null,
    slaResolveMet: null, slaResponseWarnAt: null, slaResolveWarnAt: null, slaPausedAt: null, slaPausedMinutes: 0,
    createdBy: { fullName: 'A' }, ...o,
  };
}

function makeApp(tickets: Record<string, Row>, scope: string[] = ['co-1']) {
  const tx = {
    ticketNote: { updateMany: vi.fn(async () => ({})) },
    attachment: { updateMany: vi.fn(async () => ({})) },
    ticketWatcher: { findMany: vi.fn(async () => []), createMany: vi.fn(async () => ({})) },
    ticket: { updateMany: vi.fn(async () => ({})), update: vi.fn(async () => ({})) },
    ticketHistory: { create: vi.fn(async () => ({})) },
  };
  const prisma = {
    staffCompany: { findMany: async () => scope.map(companyId => ({ companyId })) },
    ticket: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => tickets[where.id] ?? null),
      count: vi.fn(async () => 0),
      update: vi.fn(async () => ({})),
    },
    ticketHistory: { create: vi.fn(async () => ({})) },
    ticketWatcher: { create: vi.fn(async ({ data }: { data: Row }) => ({ id: 'w1', email: data.email, staffId: data.staffId, createdAt: new Date(), staff: null })) },
    company: { findUnique: async () => ({ allowedDomains: ['acme.com'], slaSettings: null }) },
    companyHoliday: { findMany: async () => [] },
    staff: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(async (arg: unknown) => (typeof arg === 'function' ? (arg as (t: typeof tx) => unknown)(tx) : Promise.all(arg as unknown[]))),
  };
  const app = buildTestApp(prisma);
  app.setErrorHandler((err: { statusCode?: number; message: string }, _req, reply) => {
    reply.status(err.statusCode ?? 500).send({ success: false, error: err.message });
  });
  app.register(relationRoutes, { prefix: '/tickets' });
  return { app, prisma, tx };
}

describe('POST /tickets/:id/merge', () => {
  const tickets = {
    src: ticketRow(),
    dst: ticketRow({ id: 'dst', ticketNumber: 'TKT-2026-00002', createdByEmail: 'b@acme.com', accessToken: 'tok-dst' }),
  };

  it('notları ve ekleri taşır, kaynağı kapatır, talep sahibini hedefe CC ekler', async () => {
    const { app, tx } = makeApp(tickets);
    const res = await app.inject({ method: 'POST', url: '/tickets/src/merge', headers: authHeader(StaffRole.it_manager), payload: { targetId: 'dst' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(tx.ticketNote.updateMany).toHaveBeenCalledWith({ where: { ticketId: 'src' }, data: { ticketId: 'dst' } });
    expect(tx.attachment.updateMany).toHaveBeenCalledWith({ where: { ticketId: 'src' }, data: { ticketId: 'dst' } });
    expect(tx.ticketWatcher.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ ticketId: 'dst', email: 'a@acme.com', staffId: null })],
    }));
    expect(tx.ticket.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'src' },
      data: expect.objectContaining({ status: 'closed', mergedIntoId: 'dst' }),
    }));
  });

  it('it_staff birleştiremez', async () => {
    const { app, tx } = makeApp(tickets);
    const res = await app.inject({ method: 'POST', url: '/tickets/src/merge', headers: authHeader(StaffRole.it_staff), payload: { targetId: 'dst' } });
    expect(res.statusCode).toBe(403);
    expect(tx.ticket.update).not.toHaveBeenCalled();
  });

  it('kapsam dışı hedef 403', async () => {
    const { app, tx } = makeApp({ ...tickets, dst: { ...tickets.dst, companyId: 'co-2' } });
    const res = await app.inject({ method: 'POST', url: '/tickets/src/merge', headers: authHeader(StaffRole.it_manager), payload: { targetId: 'dst' } });
    expect(res.statusCode).toBe(403);
    expect(tx.ticket.update).not.toHaveBeenCalled();
  });
});

describe('PUT /tickets/:id/parent', () => {
  it('alt ticket üst olamaz (tek seviye)', async () => {
    const { app } = makeApp({ c: ticketRow({ id: 'c' }), p: ticketRow({ id: 'p', parentId: 'x' }) });
    const res = await app.inject({ method: 'PUT', url: '/tickets/c/parent', headers: authHeader(StaffRole.it_staff), payload: { parentId: 'p' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /tickets/:id/watchers', () => {
  it('izinli domain dışındaki CC reddedilir', async () => {
    const { app, prisma } = makeApp({ src: ticketRow() });
    const res = await app.inject({ method: 'POST', url: '/tickets/src/watchers', headers: authHeader(StaffRole.it_staff), payload: { email: 'x@gmail.com' } });
    expect(res.statusCode).toBe(400);
    expect(prisma.ticketWatcher.create).not.toHaveBeenCalled();
  });

  it('CC eklenir ve küçük harfe çevrilir', async () => {
    const { app, prisma } = makeApp({ src: ticketRow() });
    const res = await app.inject({ method: 'POST', url: '/tickets/src/watchers', headers: authHeader(StaffRole.it_staff), payload: { email: 'Mudur@Acme.com' } });
    expect(res.statusCode, res.body).toBe(201);
    expect(prisma.ticketWatcher.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ email: 'mudur@acme.com', staffId: null }) }));
  });

  it('pasif personel izleyici olamaz', async () => {
    const { app, prisma } = makeApp({ src: ticketRow() });
    prisma.staff.findUnique.mockResolvedValueOnce({ id: 's2', email: 's2@acme.com', role: 'it_staff', isActive: false } as never);
    const res = await app.inject({ method: 'POST', url: '/tickets/src/watchers', headers: authHeader(StaffRole.it_staff), payload: { staffId: 's2' } });
    expect(res.statusCode).toBe(400);
  });
});
