import { isIP } from 'node:net';
import { isPrivateNetworkAddress } from './net-guard.js';

/**
 * `TRUST_PROXY` → Fastify `trustProxy`.
 *
 * Fastify 5.12 sayısal (yalnızca hop sayısı) güveni kaldırdı: doğrudan bağlanan bir
 * istemci yeterli sayıda `X-Forwarded-For` girdisi uydurarak IP'sini seçebiliyordu.
 * Burada hop sayısı korunur AMA her güvenilen hop'un kurum içi (RFC 1918 / ULA) ya da
 * loopback bir adres olması şartı eklenir — yani yalnızca Docker ağındaki / iç ağdaki
 * proxy'lere güvenilir; public bir eş (doğrudan istemci) asla proxy sayılmaz.
 *
 * Sayı dışındaki değer (ör. `172.18.0.0/16,10.0.0.5`) Fastify'a olduğu gibi IP/CIDR
 * listesi olarak geçer.
 */
export function isInternalAddress(ip: string): boolean {
  const addr = ip.toLowerCase();
  if (addr === '::1' || addr.startsWith('127.') || addr.startsWith('::ffff:127.')) return true;
  return isIP(addr) !== 0 && isPrivateNetworkAddress(addr);
}

export type TrustProxySetting = boolean | string | ((address: string, hop: number) => boolean);

export function buildTrustProxy(value: string): TrustProxySetting {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const hops = Number(trimmed);
    if (hops === 0) return false;
    return (address: string, hop: number) => hop < hops && isInternalAddress(address);
  }
  return trimmed;
}
