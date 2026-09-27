import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { runAutoClose } from '../../src/jobs/auto-close.js';

/**
 * Otomatik kapatma turu: şirket ayarına göre çözülen/yanıt beklenen ticket'lar
 * kapatılır, hatırlatma bir kez gönderilir.
 */

const NOW = new Date('2026-07-20T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

type Row = Record<string, unknown>;

function ticket(overrides: Row = {}): Row {
  return {
    id: 't1',
    ticketNumber: 'TKT-1',
    subject: 'VPN',
    status: 'resolved',
    priority: 'medium',
    companyId: 'co-1',
    locale: 'en',
    accessToken: 'tok',
    createdByEmail: 'user@acme.com',
    createdBy: { fullName: 'User' },
    firstRespondedAt: new Date('2026-07-01T10:00:00Z'),
    resolvedAt: new Date('2026-07-10T10:00:00Z'),
    slaResponseDue: null,
    slaResolveDue: null,
    slaResponseMet: true,
    slaResolveMet: true,
    slaResponseWarnAt: null,
    slaResolveWarnAt: null,
    slaPausedAt: null,
    slaPausedMinutes: 0,
    ...overrides,
  };
}

function makePrisma(opts: { slaSettings?: unknown; resolved?: Row[]; waiting?: Row[]; reminderDue?: Row[] }) {
  const update = vi.fn(async () => ({}));
  const findMany = vi.fn(async ({ where }: { where: Row }) => {
    if (where.status === 'resolved') return opts.resolved ?? [];
    if ('autoCloseReminderAt' in where) return opts.reminderDue ?? [];
    return opts.waiting ?? [];
  });
  const prisma = {
    company: {
      findMany: async () => [{ id: 'co-1', slaSettings: opts.slaSettings ?? null }],
      findUnique: async () => ({ slaSettings: opts.slaSettings ?? null }),
    },
    companyHoliday: { findMany: async () => [] },
    ticket: { findMany, update },
  } as unknown as PrismaClient;
  return { prisma, update, findMany };
}

function deps() {
  return { queueEmail: vi.fn(async () => undefined), broadcastStaff: vi.fn(), broadcastTicket: vi.fn() };
}

describe('runAutoClose', () => {
  it('varsayılan: 7 gün yeniden açılmayan çözülmüş ticket kapatılır ve talep sahibine bildirilir', async () => {
    const { prisma, update, findMany } = makePrisma({ resolved: [ticket()] });
    const d = deps();
    const result = await runAutoClose(prisma, NOW, d);

    const [[args]] = findMany.mock.calls as unknown as [[{ where: { statusChangedAt: { lte: Date } } }]];
    expect(args.where.statusChangedAt.lte).toEqual(new Date(NOW.getTime() - 7 * DAY));

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 't1' },
      data: expect.objectContaining({
        status: 'closed',
        closedAt: NOW,
        history: { create: expect.arrayContaining([expect.objectContaining({ action: 'auto_closed', newValue: 'resolved' })]) },
      }),
    }));
    expect(d.queueEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@acme.com',
      templateSlug: 'ticket_auto_closed',
      variables: expect.objectContaining({ reasonText: expect.stringContaining('7 days'), trackingUrl: expect.stringContaining('/ticket/tok') }),
    }));
    expect(d.broadcastTicket).toHaveBeenCalledWith('tok', 'ticket_updated', expect.objectContaining({ status: 'closed' }));
    expect(result.closed).toBe(1);
  });

  it('bekleme kuralları varsayılan olarak kapalıdır', async () => {
    const { prisma, findMany } = makePrisma({ waiting: [ticket({ status: 'waiting_user_response' })] });
    await runAutoClose(prisma, NOW, deps());
    // Yalnızca "resolved" sorgusu çalışır.
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('resolvedAfterDays=0 → çözülmüşler kapatılmaz', async () => {
    const { prisma, findMany } = makePrisma({ slaSettings: { autoClose: { resolvedAfterDays: 0 } }, resolved: [ticket()] });
    const result = await runAutoClose(prisma, NOW, deps());
    expect(findMany).not.toHaveBeenCalled();
    expect(result.closed).toBe(0);
  });

  it('yanıt gelmeyen ticket kapatılır; SLA duraklatması sonlandırılır', async () => {
    const waiting = ticket({
      status: 'waiting_user_response', resolvedAt: null, slaResolveMet: null,
      slaResolveDue: new Date('2026-07-15T12:00:00Z'), slaPausedAt: new Date('2026-07-12T12:00:00Z'),
    });
    const { prisma, update } = makePrisma({
      slaSettings: { autoClose: { waitingReminderAfterDays: 3, waitingCloseAfterDays: 7 } },
      waiting: [waiting],
    });
    const d = deps();
    await runAutoClose(prisma, NOW, d);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'closed',
        slaPausedAt: null,
        // Bekleme süresi SLA'ya sayılmaz → çözüm SLA'sı tutturulmuş sayılır.
        slaResolveMet: true,
      }),
    }));
    expect(d.queueEmail).toHaveBeenCalledWith(expect.objectContaining({
      templateSlug: 'ticket_auto_closed',
      variables: expect.objectContaining({ reasonText: 'We did not receive a reply within 7 days.' }),
    }));
  });

  it('hatırlatma bir kez gönderilir ve kalan süreyi belirtir', async () => {
    const { prisma, update, findMany } = makePrisma({
      slaSettings: { autoClose: { resolvedAfterDays: 0, waitingReminderAfterDays: 3, waitingCloseAfterDays: 7 } },
      reminderDue: [ticket({ status: 'waiting_user_response' })],
    });
    const d = deps();
    const result = await runAutoClose(prisma, NOW, d);
    const reminderQuery = findMany.mock.calls.find(([a]) => 'autoCloseReminderAt' in (a).where);
    expect(reminderQuery?.[0]).toMatchObject({ where: { autoCloseReminderAt: null } });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ autoCloseReminderAt: NOW }),
    }));
    expect(d.queueEmail).toHaveBeenCalledWith(expect.objectContaining({
      templateSlug: 'ticket_waiting_reminder',
      variables: expect.objectContaining({ closeNote: expect.stringContaining('4 days') }),
    }));
    expect(result.reminded).toBe(1);
  });
});
