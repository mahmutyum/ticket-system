import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
// backup/lib.mjs yedekleme servisinin SAF yardımcılarıdır (G/Ç yok) — bu testler
// PRODUCTION'DA backup konteynerinde koşan kodu doğrular; backend kopyası değil.
import {
  decryptPayload,
  parseTargetConfig,
  extractHostsFromIni,
  checkDumpSanity,
  requiredFreeBytes,
  selectGfsKeep,
  MIN_DUMP_BYTES,
} from '../../../backup-service/lib.mjs';

const KEY = 'a'.repeat(64);

/** lib.mjs yalnızca decrypt içerir (şifreleme backend'de); test için kendimiz üretiriz. */
function encryptForTest(plain: string, keyHex: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

describe('decryptPayload', () => {
  it('backend encrypt formatını çözer ("iv:tag:payload" base64)', () => {
    const encrypted = encryptForTest('[target]\ntype = s3\n', KEY);
    expect(decryptPayload(encrypted, KEY)).toBe('[target]\ntype = s3\n');
  });

  it('yanlış anahtar auth tag hatasıyla düşer — sessiz bozuk veri dönmez', () => {
    const encrypted = encryptForTest('secret', KEY);
    const otherKey = 'b'.repeat(64);
    expect(() => decryptPayload(encrypted, otherKey)).toThrow();
  });

  it('kötü format ve kısa anahtar reddedilir', () => {
    expect(() => decryptPayload('not-encrypted', KEY)).toThrow();
    expect(() => decryptPayload(encryptForTest('x', KEY), 'abc')).toThrow();
  });
});

describe('parseTargetConfig', () => {
  it('çözümler ve remote adını sabitler', () => {
    const enc = encryptForTest('[target]\ntype = s3\nendpoint = https://s3.example.com\n', KEY);
    const parsed = parseTargetConfig(enc, KEY);
    expect(parsed.remote).toBe('target');
    expect(parsed.ini).toContain('type = s3');
  });

  it('[target] remote adı yoksa reddeder — worker rclone adresini bulamaz', () => {
    const enc = encryptForTest('[other]\ntype = s3\n', KEY);
    expect(() => parseTargetConfig(enc, KEY)).toThrow(/\[target\]/);
  });
});

describe('extractHostsFromIni', () => {
  it('endpoint/url/host değerlerini çıkarır', () => {
    const ini = '[target]\ntype = s3\nendpoint = https://s3.example.com\nhost = ftp.internal.corp\n';
    expect(extractHostsFromIni(ini)).toEqual(['s3.example.com', 'ftp.internal.corp']);
  });
});

describe('checkDumpSanity', () => {
  it('boş/eksik dump başarısız sayılır', () => {
    expect(checkDumpSanity(0)).toMatch(/0 byte/);
    expect(checkDumpSanity(Number.NaN)).toBeTruthy();
  });

  it('şüpheli küçük dump reddedilir', () => {
    expect(checkDumpSanity(100)).toMatch(/şüpheli küçük/);
    expect(checkDumpSanity(MIN_DUMP_BYTES)).toBeNull();
  });
});

describe('requiredFreeBytes', () => {
  it('en az 1 GB ister, büyük geçmişte 2 kat + tampon ister', () => {
    expect(requiredFreeBytes(0)).toBe(1024 * 1024 * 1024);
    expect(requiredFreeBytes(1024 * 1024 * 1024)).toBe(2 * 1024 * 1024 * 1024 + 256 * 1024 * 1024);
  });
});

describe('selectGfsKeep — GFS rotasyonu', () => {
  const days = (offsets: number[]): Array<{ key: string; stamp: Date }> =>
    offsets.map((o) => ({ key: `20261113T000000Z-${o}`, stamp: new Date(Date.UTC(2026, 10, 13) - o * 86400000) }));

  it('son yedeği HER KOŞULDA saklar — son başarılı yedek asla silinmez', () => {
    const entries = [{ key: 'only', stamp: new Date(Date.UTC(2020, 0, 1)) }];
    const keep = selectGfsKeep(entries, { daily: 7, weekly: 4, monthly: 6 }, new Date(Date.UTC(2026, 10, 13)));
    expect(keep.has('only')).toBe(true);
  });

  it('aynı günün birden fazla yedeğini saklar (gün penceresi içinde)', () => {
    const entries = days([0, 0.1, 1, 2]); // iki yedek bugün, dün, evvelsi gün
    const keep = selectGfsKeep(entries, { daily: 7, weekly: 4, monthly: 6 }, entries[0].stamp);
    for (const entry of entries) expect(keep.has(entry.key)).toBe(true);
  });

  it('pencere dışındaki eski yedekleri saklamaz', () => {
    const now = new Date(Date.UTC(2026, 10, 13));
    const entries = [
      { key: 'new', stamp: now },
      { key: 'old-30d', stamp: new Date(now.getTime() - 30 * 86400000) },
      { key: 'old-60d', stamp: new Date(now.getTime() - 60 * 86400000) },
    ];
    const keep = selectGfsKeep(entries, { daily: 7, weekly: 4, monthly: 6 }, now);
    expect(keep.has('new')).toBe(true);
    // 30 gün önceki yedek "son 6 ay" penceresinde kalır
    expect(keep.has('old-30d')).toBe(true);
    // 60 gün önceki de 6 aylık pencerede (6 ay ≈ 180 gün)
    expect(keep.has('old-60d')).toBe(true);
  });

  it('monthly penceresi dışındaki yedekleri silinecek bırakır', () => {
    // 8 ayrı ay: monthly=6 → en yeni 6 ay saklanır, 7./8. ay silinecek kalır.
    const now = new Date(Date.UTC(2026, 10, 13));
    const entries = [
      { key: 'm0', stamp: now }, // 2026-11
      { key: 'm1', stamp: new Date(Date.UTC(2026, 9, 13)) },
      { key: 'm2', stamp: new Date(Date.UTC(2026, 8, 13)) },
      { key: 'm3', stamp: new Date(Date.UTC(2026, 7, 13)) },
      { key: 'm4', stamp: new Date(Date.UTC(2026, 6, 13)) },
      { key: 'm5', stamp: new Date(Date.UTC(2026, 5, 13)) },
      { key: 'm6', stamp: new Date(Date.UTC(2026, 4, 13)) },
      { key: 'm7', stamp: new Date(Date.UTC(2026, 3, 13)) },
    ];
    const keep = selectGfsKeep(entries, { daily: 7, weekly: 4, monthly: 6 }, now);
    for (const key of ['m0', 'm1', 'm2', 'm3', 'm4', 'm5']) expect(keep.has(key)).toBe(true);
    // m6, "son 7 ayrı gün" penceresinin 7. günü olduğu için daily penceresinden de saklanır.
    expect(keep.has('m6')).toBe(true);
    // m7: 8. ayrı gün, 7. ayrı ay ve 8. ayrı hafta — üç pencere de dolu, silinecek.
    expect(keep.has('m7')).toBe(false);
  });
});
