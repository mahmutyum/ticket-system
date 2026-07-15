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
