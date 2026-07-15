import { describe, it, expect } from 'vitest';
import { isBlockedAddress, assertPublicHost, BlockedHostError } from '../../src/utils/net-guard.js';

/**
 * SSRF koruması.
 *
 * Şirket SMTP ayarındaki `host` serbest yazılıyor ve sunucu ona TCP açıyor.
 * `POST /companies/:id/smtp/test` yarı-kör bir SSRF + port tarayıcısıydı: dahili
 * ağ (postgres:5432, redis:6379) ve bulut metadata (169.254.169.254) hedef
 * alınabiliyordu.
 */

describe('isBlockedAddress — IPv4', () => {
  it('loopback engellenir', () => {
    expect(isBlockedAddress('127.0.0.1')).toBe(true);
    expect(isBlockedAddress('127.255.255.254')).toBe(true);
  });

  it('bulut metadata engellenir', () => {
    // AWS/GCP/Azure metadata — SSRF'in klasik hedefi.
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
  });

  it('özel ağlar engellenir', () => {
    expect(isBlockedAddress('10.0.0.5')).toBe(true);
    expect(isBlockedAddress('172.16.0.1')).toBe(true);
    expect(isBlockedAddress('172.31.255.255')).toBe(true);
    expect(isBlockedAddress('192.168.1.1')).toBe(true);
  });

  it('172.32.x PUBLIC\'tir — maske doğru hesaplanmalı', () => {
    // 172.16.0.0/12 → 172.16–172.31. 172.32 aralık DIŞI.
    expect(isBlockedAddress('172.32.0.1')).toBe(false);
    expect(isBlockedAddress('172.15.0.1')).toBe(false);
  });

  it('CGNAT ve ayrılmış aralıklar engellenir', () => {
    expect(isBlockedAddress('100.64.0.1')).toBe(true);
    expect(isBlockedAddress('0.0.0.0')).toBe(true);
    expect(isBlockedAddress('224.0.0.1')).toBe(true);
  });

  it('gerçek public adresler geçer', () => {
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
    expect(isBlockedAddress('1.1.1.1')).toBe(false);
    expect(isBlockedAddress('93.184.216.34')).toBe(false);
  });
});

describe('isBlockedAddress — IPv6', () => {
  it('loopback ve link-local engellenir', () => {
    expect(isBlockedAddress('::1')).toBe(true);
    expect(isBlockedAddress('fe80::1')).toBe(true);
  });

  it('unique local engellenir', () => {
    expect(isBlockedAddress('fd00::1')).toBe(true);
    expect(isBlockedAddress('fc00::1')).toBe(true);
  });

  it('IPv4-mapped loopback engellenir', () => {
    // ::ffff:127.0.0.1 — v6 gibi görünen v4 loopback; atlanırsa baypas olur.
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:169.254.169.254')).toBe(true);
  });

  it('public IPv6 geçer', () => {
    expect(isBlockedAddress('2001:4860:4860::8888')).toBe(false);
  });
});

describe('isBlockedAddress — geçersiz girdi', () => {
  it('IP olmayan değer güvenli tarafa düşer (engellenir)', () => {
    expect(isBlockedAddress('bir-sey')).toBe(true);
    expect(isBlockedAddress('')).toBe(true);
    expect(isBlockedAddress('999.999.999.999')).toBe(true);
  });
});

describe('assertPublicHost', () => {
  it('doğrudan verilen loopback IP reddedilir', async () => {
    await expect(assertPublicHost('127.0.0.1')).rejects.toBeInstanceOf(BlockedHostError);
  });

  it('metadata IP reddedilir', async () => {
    await expect(assertPublicHost('169.254.169.254')).rejects.toBeInstanceOf(BlockedHostError);
  });

  it('localhost ADI reddedilir — kontrol DNS sonrası yapılır', async () => {
    // Sadece hostname'e bakılsaydı bu geçerdi. localhost 127.0.0.1'e çözülür.
    await expect(assertPublicHost('localhost')).rejects.toBeInstanceOf(BlockedHostError);
  });

  it('compose servis adı reddedilir (dahili ağ)', async () => {
    // Çözülemeyen isim de reddedilir — zaten bağlanamaz, net hata iyi.
    await expect(assertPublicHost('postgres')).rejects.toBeInstanceOf(BlockedHostError);
  });

  it('boş host reddedilir', async () => {
    await expect(assertPublicHost('   ')).rejects.toBeInstanceOf(BlockedHostError);
  });

  it('public IP kabul edilir', async () => {
    await expect(assertPublicHost('8.8.8.8')).resolves.toBeUndefined();
  });
});
