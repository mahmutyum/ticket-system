import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { runSlaCheck } from '../../src/jobs/sla-check.js';

/**
 * SLA kontrol turu: hangi sorgunun hangi ticket'ı döndürdüğü `where`
 * anahtarlarından ayırt edilir (yanıt/çözüm × ihlal/uyarı).
 */

const NOW = new Date('2026-07-15T12:00:00Z');

type Row = Record<string, unknown>;

function baseTicket(overrides: Row = {}): Row {
  return {
    id: 't1',
    ticketNumber: 'TKT-1',
    subject: 'Yazıcı',
    priority: 'medium',
    companyId: 'co-1',
    slaResponseDue: new Date('2026-07-15T11:00:00Z'),
    slaResolveDue: new Date('2026-07-15T15:00:00Z'),
    company: { name: 'Acme' },
    assignedTo: { email: 'tech@acme.com', fullName: 'Tech', locale: 'en', isActive: true },
    ...overrides,
  };
}

function makePrisma(opts: {
  responseBreach?: Row[];
  resolveBreach?: Row[];
  responseWarn?: Row[];
  resolveWarn?: Row[];
  slaSettings?: unknown;
  managers?: Row[];
  admins?: Row[];
}) {
  const update = vi.fn(async () => ({}));
  const historyCreate = vi.fn(async () => ({}));
  const findMany = vi.fn(async ({ where }: { where: Row }) => {
    if ('slaResponseDue' in where) return opts.responseBreach ?? [];
    if ('slaResolveDue' in where) return opts.resolveBreach ?? [];
    if ('slaResponseWarnAt' in where) return opts.responseWarn ?? [];
    if ('slaResolveWarnAt' in where) return opts.resolveWarn ?? [];
    return [];
  });
  const staffFindMany = vi.fn(async ({ where }: { where: Row }) =>
    where.role === 'it_manager' ? (opts.managers ?? []) : (opts.admins ?? []),
  );
  const prisma = {
    ticket: { findMany, update },
    ticketHistory: { create: historyCreate },
    company: { findUnique: async () => ({ slaSettings: opts.slaSettings ?? null }) },
    companyHoliday: { findMany: async () => [] },
    staff: { findMany: staffFindMany },
  } as unknown as PrismaClient;
  return { prisma, update, historyCreate, findMany };
}

function deps() {
  return { queueEmail: vi.fn(async () => undefined), broadcast: vi.fn() };
}

describe('runSlaCheck', () => {
  it('duraklatılmış ve kapanmış ticket\'ları sorgu seviyesinde dışlar', async () => {
    const { prisma, findMany } = makePrisma({});
    await runSlaCheck(prisma, NOW, deps());
    for (const [args] of findMany.mock.calls) {
      expect(args.where).toMatchObject({ slaPausedAt: null, status: { notIn: ['resolved', 'closed'] } });
    }
  });

  it('yanıt ihlali: met=false yazar, bekleyen uyarıyı temizler, atanana alıcının dilinde bildirir', async () => {
    const { prisma, update } = makePrisma({ responseBreach: [baseTicket()], managers: [] });
    const d = deps();
    const result = await runSlaCheck(prisma, NOW, d);

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 't1' },
      data: expect.objectContaining({ slaResponseMet: false, slaResponseWarnAt: null }),
    }));
    expect(d.queueEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'tech@acme.com',
      templateSlug: 'sla_warning',
      variables: expect.objectContaining({ slaType: 'Response Time' }),
    }));
    expect(d.broadcast).toHaveBeenCalledWith('sla_alert', expect.objectContaining({ level: 'breached', kind: 'response' }), 'co-1');
    expect(result.breaches).toBe(1);
  });

  it('ihlalde şirketin IT yöneticilerine eskalasyon gönderir', async () => {
    const { prisma, historyCreate } = makePrisma({
      resolveBreach: [baseTicket()],
      managers: [{ email: 'boss@acme.com', fullName: 'Boss', locale: 'tr' }],
    });
    const d = deps();
    const result = await runSlaCheck(prisma, NOW, d);

    expect(d.queueEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'boss@acme.com',
      templateSlug: 'sla_escalation',
      variables: expect.objectContaining({ slaType: 'Çözüm Süresi', assigneeName: 'Tech' }),
    }));
    expect(historyCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'sla_escalated' }) });
    expect(result.escalations).toBe(1);
  });

  it('eskalasyon kapalıysa yalnızca atanan bilgilendirilir', async () => {
    const { prisma } = makePrisma({
      resolveBreach: [baseTicket()],
      managers: [{ email: 'boss@acme.com', fullName: 'Boss', locale: 'tr' }],
      slaSettings: { escalation: { notifyManagers: false } },
    });
    const d = deps();
    await runSlaCheck(prisma, NOW, d);
    expect(d.queueEmail).toHaveBeenCalledTimes(1);
  });

  it('atanmamış ticket: ayar kapalı olsa da yöneticiler bilgilendirilir; yönetici yoksa admin', async () => {
    const { prisma } = makePrisma({
      responseBreach: [baseTicket({ assignedTo: null })],
      managers: [],
      admins: [{ email: 'admin@acme.com', fullName: 'Admin', locale: 'tr' }],
      slaSettings: { escalation: { notifyManagers: false } },
    });
    const d = deps();
    await runSlaCheck(prisma, NOW, d);
    expect(d.queueEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'admin@acme.com', templateSlug: 'sla_escalation' }));
  });

  it('çözüm ihlalinde ayar açıksa önceliği bir kademe yükseltir', async () => {
    const { prisma, update } = makePrisma({
      resolveBreach: [baseTicket({ priority: 'high' })],
      slaSettings: { escalation: { bumpPriority: true } },
    });
    await runSlaCheck(prisma, NOW, deps());
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ priority: 'critical' }),
    }));
  });

  it('kritik öncelik daha fazla yükseltilmez', async () => {
    const { prisma, update } = makePrisma({
      resolveBreach: [baseTicket({ priority: 'critical' })],
      slaSettings: { escalation: { bumpPriority: true } },
    });
    await runSlaCheck(prisma, NOW, deps());
    const [[args]] = update.mock.calls as unknown as [[{ data: Row }]];
    expect(args.data).not.toHaveProperty('priority');
  });

  it('ihlal öncesi uyarı: bir kez gönderilir (uyarı anı null\'lanır)', async () => {
    const { prisma, update } = makePrisma({ resolveWarn: [baseTicket()] });
    const d = deps();
    const result = await runSlaCheck(prisma, NOW, d);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ slaResolveWarnAt: null }),
    }));
    expect(d.queueEmail).toHaveBeenCalledWith(expect.objectContaining({ templateSlug: 'sla_approaching' }));
    expect(d.broadcast).toHaveBeenCalledWith('sla_alert', expect.objectContaining({ level: 'approaching' }), 'co-1');
    expect(result.warnings).toBe(1);
  });

  it('pasif personel atanmışsa uyarı yöneticilere gider', async () => {
    const { prisma } = makePrisma({
      responseWarn: [baseTicket({ assignedTo: { email: 'gone@acme.com', fullName: 'Gone', locale: 'tr', isActive: false } })],
      managers: [{ email: 'boss@acme.com', fullName: 'Boss', locale: 'tr' }],
    });
    const d = deps();
    await runSlaCheck(prisma, NOW, d);
    expect(d.queueEmail).toHaveBeenCalledTimes(1);
    expect(d.queueEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'boss@acme.com' }));
  });
});
