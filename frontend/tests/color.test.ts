import { describe, it, expect } from 'vitest';
import { generatePalette, applyPalette } from '../src/utils/color';

/**
 * Şirket branding rengi — CSS injection geçidi.
 *
 * `primaryColor` admin tarafından yazılıyor ve `root.style.setProperty` ile canlı
 * bir CSS değişkenine gidiyor. Bu yolun güvenliği tamamen `hexToRgb`'deki katı
 * regex'e bağlı: eşleşmezse zincir null döner ve setProperty'ye HİÇ ulaşılmaz.
 *
 * Güvenlik taramasında bu yol "NOT VULNERABLE" çıktı. Bu testler o geçidin
 * açılmamasını sağlar — regex bir gün gevşetilirse burada kırılır.
 *
 * (hexToRgb dışa açık değil; davranışı public API üzerinden ölçülür.)
 */

describe('generatePalette — geçit', () => {
  it('CSS payload REDDEDİLİR (null döner)', () => {
    expect(generatePalette('red; background: url(//evil.tld)')).toBeNull();
    expect(generatePalette('#2563eb; --x: y')).toBeNull();
    expect(generatePalette('expression(alert(1))')).toBeNull();
    expect(generatePalette('url(javascript:alert(1))')).toBeNull();
    expect(generatePalette('javascript:alert(1)')).toBeNull();
  });

  it('hatalı hex reddedilir', () => {
    expect(generatePalette('#fff')).toBeNull(); // 3 haneli desteklenmiyor
    expect(generatePalette('#12345')).toBeNull();
    expect(generatePalette('#1234567')).toBeNull();
    expect(generatePalette('#gggggg')).toBeNull();
    expect(generatePalette('')).toBeNull();
  });

  it('geçerli hex kabul edilir (# ile veya #\'siz)', () => {
    expect(generatePalette('#2563eb')).not.toBeNull();
    expect(generatePalette('2563eb')).not.toBeNull();
    expect(generatePalette('  #2563EB  ')).not.toBeNull(); // kırpılır
  });

  it('Tailwind ton skalasını üretir', () => {
    const p = generatePalette('#2563eb')!;
    for (const shade of [50, 100, 500, 600, 900]) {
      expect(p[shade]).toBeDefined();
    }
  });

  it('CSS\'e giden TEK biçim sayısal RGB üçlüsüdür', () => {
    // Asıl güvenlik iddiası: setProperty'ye yalnızca makine üretimi sayılar gider.
    const p = generatePalette('#2563eb')!;
    for (const v of Object.values(p)) {
      expect(v).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
    }
  });
});

describe('applyPalette', () => {
  it('geçersiz renkte hiçbir CSS değişkeni YAZMAZ', () => {
    document.documentElement.style.removeProperty('--color-primary-500');
    const ok = applyPalette('javascript:alert(1)');
    expect(ok).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--color-primary-500')).toBe('');
  });

  it('null/undefined güvenle ele alınır', () => {
    expect(applyPalette(null)).toBe(false);
    expect(applyPalette(undefined)).toBe(false);
  });

  it('geçerli renkte değişkenleri yazar', () => {
    const ok = applyPalette('#2563eb');
    expect(ok).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--color-primary-500')).toMatch(
      /^\d{1,3} \d{1,3} \d{1,3}$/,
    );
  });
});
