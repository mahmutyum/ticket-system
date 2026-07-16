import { describe, expect, it } from 'vitest';
import { generateTotpSecret, totpCode, totpUri, verifyTotp } from '../../src/utils/totp.js';

describe('TOTP', () => {
  it('RFC 6238 uyumlu altı haneli kod üretir ve doğrular', () => {
    const secret = generateTotpSecret();
    const time = 1_700_000_000_000;
    const code = totpCode(secret, time);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code, time)).toBe(true);
    expect(verifyTotp(secret, '000000', time)).toBe(code === '000000');
  });

  it('bir önceki ve sonraki zaman penceresini kabul eder', () => {
    const secret = generateTotpSecret();
    const time = 1_700_000_000_000;
    expect(verifyTotp(secret, totpCode(secret, time - 30_000), time)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, time + 30_000), time)).toBe(true);
  });

  it('otpauth URI içinde issuer ve hesabı güvenli kodlar', () => {
    expect(totpUri('ABC', 'a+b@example.com', 'IT Destek')).toContain('issuer=IT%20Destek');
  });
});
