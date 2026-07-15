import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.CREDENTIALS_ENC_KEY = '0'.repeat(64); // 32 byte hex
});

describe('crypto util', () => {
  it('encrypt sonra decrypt orijinal metni döndürür', async () => {
    const { encrypt, decrypt } = await import('../../src/utils/crypto.js');
    const plain = 'S3cr3t!Şifre';
    const enc = encrypt(plain);
    expect(enc).not.toContain(plain);
    expect(enc.split(':')).toHaveLength(3);
    expect(decrypt(enc)).toBe(plain);
  });

  it('aynı girdi için farklı IV ile farklı ciphertext üretir', async () => {
    const { encrypt } = await import('../../src/utils/crypto.js');
    expect(encrypt('aynı')).not.toBe(encrypt('aynı'));
  });

  it('bozuk payload decrypt edilince hata fırlatır', async () => {
    const { decrypt } = await import('../../src/utils/crypto.js');
    expect(() => decrypt('bozuk:veri:burada')).toThrow();
  });
});

/**
 * `looksEncrypted`, şifrelemenin sonradan eklendiği alanlarda (CompanySmtp.pass)
 * eski düz metin kayıtları yenilerinden ayırmak için kullanılır.
 *
 * Yanlış POZİTİF: düz metin şifre "şifreli" sanılır → decrypt patlar, e-posta durur.
 * Yanlış NEGATİF: şifreli değer düz metin sanılır → SMTP'ye çöp şifre gider.
 */
describe('looksEncrypted', () => {
  it('encrypt çıktısını tanır', async () => {
    const { encrypt, looksEncrypted } = await import('../../src/utils/crypto.js');
    expect(looksEncrypted(encrypt('herhangi bir şifre'))).toBe(true);
  });

  it('düz metin şifreyi şifreli sanmaz', async () => {
    const { looksEncrypted } = await import('../../src/utils/crypto.js');
    expect(looksEncrypted('duzmetin')).toBe(false);
    expect(looksEncrypted('P@ssw0rd!')).toBe(false);
    expect(looksEncrypted('')).toBe(false);
  });

  it("içinde ':' geçen düz metin şifreyi şifreli sanmaz", async () => {
    const { looksEncrypted } = await import('../../src/utils/crypto.js');
    // Format kontrolü yapısaldır: IV 12, authTag 16 byte olmalı.
    expect(looksEncrypted('user:pass:host')).toBe(false);
    expect(looksEncrypted('a:b:c')).toBe(false);
    expect(looksEncrypted('smtp:587:secret')).toBe(false);
  });

  it('yanlış parça sayısını reddeder', async () => {
    const { encrypt, looksEncrypted } = await import('../../src/utils/crypto.js');
    const enc = encrypt('x');
    const [iv, tag] = enc.split(':');
    expect(looksEncrypted(`${iv}:${tag}`)).toBe(false);
    expect(looksEncrypted(`${enc}:fazladan`)).toBe(false);
  });

  it('tanıdığı her değer gerçekten decrypt edilebilir', async () => {
    const { encrypt, decrypt, looksEncrypted } = await import('../../src/utils/crypto.js');
    for (const plain of ['a', 'uzun bir şifre 123!@#', 'içinde:iki-nokta:var']) {
      const enc = encrypt(plain);
      expect(looksEncrypted(enc)).toBe(true);
      expect(decrypt(enc)).toBe(plain);
    }
  });
});
