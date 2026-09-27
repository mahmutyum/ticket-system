import { describe, it, expect } from 'vitest';
import { TicketStatus } from '@prisma/client';
import { planStatusTransition, type TicketLifecycleState } from '../../src/utils/ticket-lifecycle.js';
import { calculateSlaDueDates, shiftAfterPause } from '../../src/utils/sla.js';
import type { BusinessCalendar } from '../../src/utils/business-hours.js';

/**
 * Durum geçişlerinin SLA etkileri: duraklatma, devam (son tarih kaydırma),
 * ilk yanıt ve çözüm ölçümü.
 */

const T0 = new Date('2026-07-15T10:00:00Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

function ticket(overrides: Partial<TicketLifecycleState> = {}): TicketLifecycleState {
  return {
    status: TicketStatus.open,
    firstRespondedAt: null,
    resolvedAt: null,
    slaResponseDue: at(60),
    slaResolveDue: at(240),
    slaResponseMet: null,
    slaResolveMet: null,
    slaResponseWarnAt: at(48),
    slaResolveWarnAt: at(192),
    slaPausedAt: null,
    slaPausedMinutes: 0,
    ...overrides,
  };
}

describe('planStatusTransition — duraklatma', () => {
  it('bekleme durumuna girince SLA duraklar', () => {
    const plan = planStatusTransition(ticket({ status: TicketStatus.in_progress, firstRespondedAt: at(5) }), TicketStatus.waiting_user_response, at(30), null);
    expect(plan.data.slaPausedAt).toEqual(at(30));
    expect(plan.history.map(h => h.action)).toEqual(['status_changed', 'sla_paused']);
  });

  it('beklemeden çıkınca son tarihler duraklatılan süre kadar kayar', () => {
    const paused = ticket({ status: TicketStatus.waiting_user_response, firstRespondedAt: at(5), slaPausedAt: at(30) });
    const plan = planStatusTransition(paused, TicketStatus.in_progress, at(150), null);
    // 120 dk duraklatıldı → çözüm son tarihi 240 → 360
    expect(plan.data.slaResolveDue).toEqual(at(360));
    expect(plan.data.slaResolveWarnAt).toEqual(at(312));
    expect(plan.data.slaPausedAt).toBeNull();
    expect(plan.data.slaPausedMinutes).toBe(120);
    // Yanıt zaten verilmiş → yanıt son tarihi kaydırılmaz
    expect(plan.data.slaResponseDue).toBeUndefined();
    expect(plan.history.map(h => h.action)).toContain('sla_resumed');
  });

  it('bekleme durumları arasında geçiş duraklatmayı sürdürür', () => {
    const paused = ticket({ status: TicketStatus.waiting_user_response, firstRespondedAt: at(5), slaPausedAt: at(30) });
    const plan = planStatusTransition(paused, TicketStatus.on_hold, at(90), null);
    expect(plan.data.slaPausedAt).toBeUndefined();
    expect(plan.data.slaResolveDue).toBeUndefined();
  });

  it('beklemedeyken çözülen ticket SLA\'yı tutturmuş sayılır (bekleme süresi sayılmaz)', () => {
    // Çözüm son tarihi 240; 200'de duraklatıldı, 400'de çözüldü.
    const paused = ticket({ status: TicketStatus.waiting_other_department, firstRespondedAt: at(5), slaPausedAt: at(200) });
    const plan = planStatusTransition(paused, TicketStatus.resolved, at(400), null);
    expect(plan.data.slaResolveMet).toBe(true);
    expect(plan.data.slaResolveDue).toEqual(at(440));
  });

  it('duraklatmadan önce zaten geçmiş son tarih kaydırılmaz — ihlal silinemez', () => {
    expect(shiftAfterPause(at(60), at(90), at(200), null)).toEqual(at(60));
  });
});

describe('planStatusTransition — ilk yanıt ve çözüm', () => {
  it('open → yanıt bekleniyor ilk yanıt sayılır', () => {
    const plan = planStatusTransition(ticket(), TicketStatus.waiting_user_response, at(20), null);
    expect(plan.data.firstRespondedAt).toEqual(at(20));
    expect(plan.data.slaResponseMet).toBe(true);
    expect(plan.data.slaResponseWarnAt).toBeNull();
    expect(plan.data.slaPausedAt).toEqual(at(20));
  });

  it('geç yanıt → tutturulmadı', () => {
    const plan = planStatusTransition(ticket(), TicketStatus.in_progress, at(61), null);
    expect(plan.data.slaResponseMet).toBe(false);
  });

  it('işçinin yazdığı ihlal ezilmez', () => {
    const plan = planStatusTransition(ticket({ slaResponseMet: false }), TicketStatus.in_progress, at(10), null);
    expect(plan.data.slaResponseMet).toBe(false);
  });

  it('doğrudan kapatma çözüm olarak da ölçülür', () => {
    const plan = planStatusTransition(ticket({ status: TicketStatus.in_progress, firstRespondedAt: at(5) }), TicketStatus.closed, at(100), null);
    expect(plan.data.resolvedAt).toEqual(at(100));
    expect(plan.data.closedAt).toEqual(at(100));
    expect(plan.data.slaResolveMet).toBe(true);
    expect(plan.data.accessTokenExpiresAt).toBeInstanceOf(Date);
  });

  it('yeniden açılınca public link tekrar süresiz olur', () => {
    const plan = planStatusTransition(ticket({ status: TicketStatus.resolved, resolvedAt: at(50), firstRespondedAt: at(5) }), TicketStatus.in_progress, at(60), null);
    expect(plan.data.accessTokenExpiresAt).toBeNull();
  });

  it('aynı duruma geçiş hiçbir şey üretmez', () => {
    expect(planStatusTransition(ticket(), TicketStatus.open, at(1), null)).toEqual({ data: {}, history: [] });
  });

  it('aktörü geçmiş kayıtlarına yazar', () => {
    const plan = planStatusTransition(ticket(), TicketStatus.in_progress, at(1), null, { id: 'staff-9' });
    expect(plan.history[0]).toMatchObject({ createdById: 'staff-9', oldValue: 'open', newValue: 'in_progress' });
  });
});

describe('mesai takvimiyle duraklatma', () => {
  const cal: BusinessCalendar = {
    timezone: 'Europe/Istanbul',
    week: { mon: [{ start: '09:00', end: '18:00' }], tue: [{ start: '09:00', end: '18:00' }], fri: [{ start: '09:00', end: '18:00' }] },
    holidays: [],
  };

  it('kalan MESAİ süresini korur', () => {
    // Cuma 16:00 yerel (13:00Z) açıldı, 4 saat SLA → Pazartesi 11:00 yerel (08:00Z).
    const opened = new Date('2026-07-17T13:00:00Z');
    const { slaResolveDue } = calculateSlaDueDates({ slaResponseMinutes: null, slaResolutionMinutes: 240 }, opened, { calendar: cal });
    expect(slaResolveDue).toEqual(new Date('2026-07-20T08:00:00Z'));
    // Cuma 17:00 duraklatıldı (kalan: 1 saat Cuma + 2 saat Pzt = 180 dk),
    // Pazartesi 10:00 devam → Pazartesi 13:00 yerel (10:00Z).
    const shifted = shiftAfterPause(slaResolveDue, new Date('2026-07-17T14:00:00Z'), new Date('2026-07-20T07:00:00Z'), cal);
    expect(shifted).toEqual(new Date('2026-07-20T10:00:00Z'));
  });

  it('uyarı anını yüzdeye göre hesaplar', () => {
    const r = calculateSlaDueDates({ slaResponseMinutes: 100, slaResolutionMinutes: null }, T0, { warningPercent: 80 });
    expect(r.slaResponseWarnAt).toEqual(at(80));
    expect(calculateSlaDueDates({ slaResponseMinutes: 100, slaResolutionMinutes: null }, T0, { warningPercent: 0 }).slaResponseWarnAt).toBeUndefined();
  });
});
