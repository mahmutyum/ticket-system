import { describe, it, expect } from 'vitest';
import { calculateSlaDueDates, isSlaMet, isSlaBreached } from '../../src/utils/sla.js';

/**
 * SLA hesapları.
 *
 * Bu mantık route handler'ının içine gömülüydü ve test edilemiyordu — oysa
 * raporlardaki uyum oranları buna dayanıyor. `now` enjekte edilebilir olduğu için
 * testler saat kaymasına ve sahte zamanlayıcılara muhtaç değil.
 */

const NOW = new Date('2026-07-15T10:00:00.000Z');

describe('calculateSlaDueDates', () => {
  it('dakikaları son tarihe çevirir', () => {
    const r = calculateSlaDueDates({ slaResponseMinutes: 15, slaResolutionMinutes: 60 }, NOW);
    expect(r.slaResponseDue).toEqual(new Date('2026-07-15T10:15:00.000Z'));
    expect(r.slaResolveDue).toEqual(new Date('2026-07-15T11:00:00.000Z'));
  });

  it('kategori yoksa hiçbir son tarih üretmez', () => {
    expect(calculateSlaDueDates(null, NOW)).toEqual({});
    expect(calculateSlaDueDates(undefined, NOW)).toEqual({});
  });

  it('null süreler SLA yok demektir', () => {
    const r = calculateSlaDueDates({ slaResponseMinutes: null, slaResolutionMinutes: null }, NOW);
    expect(r.slaResponseDue).toBeUndefined();
    expect(r.slaResolveDue).toBeUndefined();
  });

  it('0 dakika SLA YOK sayılır — "sıfır dakika" anlamlı bir hedef değil', () => {
    const r = calculateSlaDueDates({ slaResponseMinutes: 0, slaResolutionMinutes: 0 }, NOW);
    expect(r.slaResponseDue).toBeUndefined();
    expect(r.slaResolveDue).toBeUndefined();
  });

  it('yalnızca biri tanımlıysa yalnızca o üretilir', () => {
    const r = calculateSlaDueDates({ slaResponseMinutes: 30, slaResolutionMinutes: null }, NOW);
    expect(r.slaResponseDue).toBeDefined();
    expect(r.slaResolveDue).toBeUndefined();
  });

  it('gün aşan süreleri doğru hesaplar', () => {
    // 480 dk = 8 saat (yeni kullanıcı talebi gibi uzun SLA'lar seed'de var)
    const r = calculateSlaDueDates({ slaResponseMinutes: 480, slaResolutionMinutes: 2880 }, NOW);
    expect(r.slaResponseDue).toEqual(new Date('2026-07-15T18:00:00.000Z'));
    expect(r.slaResolveDue).toEqual(new Date('2026-07-17T10:00:00.000Z')); // 2 gün
  });
});

describe('isSlaMet', () => {
  const due = new Date('2026-07-15T10:15:00.000Z');

  it('son tarihten önce → tutturuldu', () => {
    expect(isSlaMet(due, new Date('2026-07-15T10:14:59.000Z'))).toBe(true);
  });

  it('son tarihten sonra → kaçırıldı', () => {
    expect(isSlaMet(due, new Date('2026-07-15T10:15:01.000Z'))).toBe(false);
  });

  it('TAM son tarihte → tutturuldu (sınır dahil)', () => {
    expect(isSlaMet(due, new Date('2026-07-15T10:15:00.000Z'))).toBe(true);
  });

  it('SLA yoksa null döner — "kaçırıldı" DEĞİL', () => {
    // Bu ayrım rapor doğruluğu için kritik: uyum oranı yalnızca SLA'sı OLAN
    // ticket'lar üzerinden hesaplanmalı. false dönseydi hedefsiz her ticket
    // "ihlal" sayılıp oranı bozardı.
    expect(isSlaMet(null, NOW)).toBeNull();
    expect(isSlaMet(undefined, NOW)).toBeNull();
  });
});

describe('isSlaBreached', () => {
  const due = new Date('2026-07-15T10:15:00.000Z');

  it('süre geçmiş ve henüz yanıtlanmamış → ihlal', () => {
    expect(isSlaBreached(due, null, new Date('2026-07-15T10:16:00.000Z'))).toBe(true);
  });

  it('süre geçmemiş → ihlal değil', () => {
    expect(isSlaBreached(due, null, new Date('2026-07-15T10:10:00.000Z'))).toBe(false);
  });

  it('zaten yanıtlanmışsa ihlal değil — sonucu belli bir hedef sonradan ihlal edilemez', () => {
    expect(isSlaBreached(due, true, new Date('2026-07-20T00:00:00.000Z'))).toBe(false);
    expect(isSlaBreached(due, false, new Date('2026-07-20T00:00:00.000Z'))).toBe(false);
  });

  it('SLA yoksa ihlal yok', () => {
    expect(isSlaBreached(null, null, NOW)).toBe(false);
  });
});
