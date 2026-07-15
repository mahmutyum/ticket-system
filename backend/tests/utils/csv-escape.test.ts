import { describe, it, expect, vi } from 'vitest';

// reports.routes.ts import zincirinde Redis'e bağlanan modül yok, ama güvenli olsun.
vi.mock('../../src/db.js', () => ({ prisma: {} }));

const { csvEscape } = await import('../../src/modules/reports/reports.routes.js');

/**
 * CSV formül (DDE) enjeksiyonu.
 *
 * Önceki hali riski doğru TESPİT edip yanlış çareyi uyguluyordu: `=`/`+`/`-`/`@`
 * ile başlayan değeri tırnaklıyordu. Tırnak CSV ÇERÇEVELEMESİDİR, formül
 * nötrleştirmesi değil — Excel ayrıştırırken tırnağı soyar ve hücre yine formül
 * olur. Çare değerin başına tek tırnak koymaktır.
 *
 * Tehdit kimliksiz: POST /tickets ile konusu `=cmd|'/c calc'!A0` olan talep
 * açılır; bir yönetici CSV'yi dışa aktarıp açtığında kendi makinesinde çalışır.
 */

describe('csvEscape — formül enjeksiyonu', () => {
  it('= ile başlayan değeri NÖTRLEŞTİRİR', () => {
    const out = csvEscape("=cmd|'/c calc'!A0");
    expect(out.startsWith("'")).toBe(true);
  });

  it('+ - @ ile başlayanları nötrleştirir', () => {
    for (const v of ['+1+1', '-2+3', '@SUM(A1)']) {
      expect(csvEscape(v).startsWith("'")).toBe(true);
    }
  });

  it('BAŞTAKİ BOŞLUKLU formülü de yakalar', () => {
    // Regresyon: /^[=+\-@]/ index 0'da sabitliydi, '\t=...' hiç eşleşmiyordu →
    // ne tespit ne nötrleştirme. Excel baştaki boşluğu kırpıp formülü çalıştırırdı.
    // Nötrleştirme değerin EN BAŞINA eklenir (araya tab girse de).
    expect(csvEscape("\t=cmd|'/c calc'!A0").startsWith("'")).toBe(true);
    expect(csvEscape(" =1+1").startsWith("'")).toBe(true);
  });

  it('zararsız metni bozmaz', () => {
    expect(csvEscape('Yazıcı çalışmıyor')).toBe('Yazıcı çalışmıyor');
    expect(csvEscape('TKT-2026-00001')).toBe('TKT-2026-00001');
  });

  it('null/undefined boş döner', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });
});

describe('csvEscape — çerçeveleme', () => {
  it('ayırıcı içeren değeri tırnaklar', () => {
    expect(csvEscape('a;b')).toBe('"a;b"');
  });

  it('tırnak içeren değeri tırnaklar ve ikiler', () => {
    expect(csvEscape('a"b')).toBe('"a""b"');
  });

  it('LF içeren değeri tırnaklar', () => {
    expect(csvEscape('a\nb')).toBe('"a\nb"');
  });

  it('CR içeren değeri de tırnaklar', () => {
    // Regresyon: yalnızca \n kontrol ediliyordu; içinde CR geçen bir konu
    // tırnaklanmadan geçip satır enjeksiyonuna yol açıyordu.
    expect(csvEscape('a\rb')).toBe('"a\rb"');
    expect(csvEscape('a\r\nb')).toBe('"a\r\nb"');
  });

  it('hem formül hem çerçeveleme gerektiren değeri ikisiyle de işler', () => {
    const out = csvEscape('=a;b');
    expect(out).toBe(`"'=a;b"`);
  });
});
