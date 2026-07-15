import { lookup } from 'dns/promises';
import { isIP } from 'net';

/**
 * Giden bağlantı hedefinin dahili ağa yönelmediğini doğrular (SSRF koruması).
 *
 * Neden gerekli: şirket SMTP ayarındaki `host` admin tarafından serbestçe
 * yazılabiliyor ve sunucu ona TCP bağlantısı açıyor. Doğrulama olmadan:
 *
 *   - `POST /companies/:id/smtp/test` yarı-kör bir SSRF + port tarayıcısıdır —
 *     hata metni çağırana döndüğü için `ECONNREFUSED` / `ETIMEDOUT` / SMTP
 *     yanıtı ayrımı dahili ağın haritasını çıkarır (`postgres:5432`,
 *     `redis:6379`, `169.254.169.254` metadata).
 *   - Kalıcı ayar olarak kaydedilirse o şirketin TÜM bildirim e-postaları
 *     (ticket içerikleri, takip linkleri) saldırganın MX'ine yönlenir.
 *
 * Bu bir uygulama rolüyle (admin) erişilebilen bir yetkidir; kök değil. Yani
 * "admin zaten güvenilir" argümanı yeterli değil: admin parolası ele geçirilirse
 * bu, ağ içi keşfe açılan bir kapıdır.
 *
 * ÖNEMLİ: Kontrol DNS çözümlemesinden SONRA yapılır. Sadece hostname'e bakmak
 * işe yaramaz — saldırgan `evil.tld`'yi 127.0.0.1'e çözecek şekilde ayarlayabilir
 * (DNS rebinding'in basit hâli).
 */

/** Engellenen IPv4 aralıkları — [ağ, maske uzunluğu]. */
const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "bu ağ"
  ['10.0.0.0', 8], // özel
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local — bulut metadata (169.254.169.254)
  ['172.16.0.0', 12], // özel
  ['192.0.0.0', 24], // IETF protokol tahsisi
  ['192.168.0.0', 16], // özel
  ['198.18.0.0', 15], // benchmark
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // ayrılmış
];

function v4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function isBlockedV4(ip: string): boolean {
  const addr = v4ToInt(ip);
  if (addr === null) return true; // ayrıştırılamıyorsa güvenli tarafa düş
  for (const [net, bits] of BLOCKED_V4) {
    const netInt = v4ToInt(net)!;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((addr & mask) === (netInt & mask)) return true;
  }
  return false;
}

function isBlockedV6(ip: string): boolean {
  const a = ip.toLowerCase();
  if (a === '::1' || a === '::') return true; // loopback / unspecified
  if (a.startsWith('fe80')) return true; // link-local
  if (a.startsWith('fc') || a.startsWith('fd')) return true; // unique local
  if (a.startsWith('ff')) return true; // multicast
  // IPv4-mapped (::ffff:127.0.0.1) — v4 kuralları uygulanmalı.
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedV4(mapped[1]);
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isBlockedV4(ip);
  if (v === 6) return isBlockedV6(ip);
  return true; // IP değilse çağıran yanlış kullanıyor — reddet
}

export class BlockedHostError extends Error {
  constructor(host: string) {
    super(`Bu adrese bağlantı kurulamaz: ${host}`);
    this.name = 'BlockedHostError';
  }
}

/**
 * Hostname'in dahili/ayrılmış bir adrese çözülmediğini doğrular.
 *
 * Çözülen TÜM adresler kontrol edilir: bir isim hem public hem private A kaydı
 * döndürebilir ve bağlantı hangisine gideceğini garanti etmez.
 *
 * @throws {BlockedHostError} hedef engelli bir aralıktaysa veya çözülemiyorsa
 */
export async function assertPublicHost(host: string): Promise<void> {
  const trimmed = host.trim();
  if (!trimmed) throw new BlockedHostError(host);

  // Doğrudan IP verildiyse çözümlemeye gerek yok.
  if (isIP(trimmed)) {
    if (isBlockedAddress(trimmed)) throw new BlockedHostError(host);
    return;
  }

  let results: Array<{ address: string }>;
  try {
    results = await lookup(trimmed, { all: true });
  } catch {
    // Çözülemeyen isim zaten bağlanamaz; net bir hata ver.
    throw new BlockedHostError(host);
  }

  if (results.length === 0) throw new BlockedHostError(host);
  for (const r of results) {
    if (isBlockedAddress(r.address)) throw new BlockedHostError(host);
  }
}
