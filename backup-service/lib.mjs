import crypto from 'node:crypto';

/**
 * Yedekleme servisinin SAF yardımcıları — G/Ç yok, sahte DB yok.
 * Backend birim testleri bu dosyayı doğrudan içe aktarır (bkz. backend/tests/services/backup-lib.test.ts);
 * bu yüzden burada backend koduna bağımlılık YOKTUR ve sadece Node stdlib kullanılır.
 */

// ==================== ŞİFRELEME ====================
// Format backend/src/utils/crypto.ts ile BİREBİR ortaktır ("iv:authTag:cipher" base64,
// AES-256-GCM). Buraya kopyalanmıştır çünkü backup imajı backend kodunu/derlemesini
// paylaşmaz; format değişirse İKİ yer de birlikte değişmelidir.

/** "iv:authTag:cipher" (base64) formatını çözer. Bozuksa hata fırlatır. */
export function decryptPayload(payload, keyHex) {
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('CREDENTIALS_ENC_KEY 64 karakterlik hex (32 byte) olmalı');
  }
  const [ivB64, tagB64, dataB64] = String(payload).split(':');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Geçersiz şifreli veri formatı');
  const key = Buffer.from(keyHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

/**
 * Hedef yapılandırmasını çözümler: configEnc AES-256-GCM ile şifreli
 * rclone config INI metnidir. Konvansiyon: remote adı KESİN `target` olmalıdır —
 * worker rclone'u `--config <geçici dosya>` ile çağırır ve yolu `target:<prefix>`
 * olarak adresler. Örnek (S3):
 *
 *   [target]
 *   type = s3
 *   provider = AWS
 *   access_key_id = ...
 *   secret_access_key = ...
 *   endpoint = https://s3.example.com
 *   region = eu-central-1
 *
 * Döndürür: { remote: 'target', ini: string }
 */
export function parseTargetConfig(configEnc, keyHex) {
  const ini = decryptPayload(configEnc, keyHex);
  if (!/^\s*\[target\]\s*$/m.test(ini)) {
    throw new Error('Hedef yapılandırması [target] adında bir rclone remote içermeli');
  }
  return { remote: 'target', ini };
}

/** INI metnindeki endpoint/url değerlerini çıkarır (SSRF denetimi için). */
export function extractHostsFromIni(ini) {
  const hosts = [];
  for (const m of String(ini).matchAll(/^\s*(?:endpoint|url|host)\s*=\s*(\S+)\s*$/gim)) {
    try {
      hosts.push(new URL(m[1]).hostname);
    } catch {
      // URL olmayan değer (ör. düz host adı) — olduğu gibi bırak, net-guard çözer.
      hosts.push(m[1]);
    }
  }
  return hosts;
}

// ==================== SAĞLIK KONTROLLERİ ====================

/** Sıfır/bozuk dump koruması: bu boyutun altındaki dump başarısız sayılır. */
export const MIN_DUMP_BYTES = 8192;

/** Dump boyutu sağduyu kontrolü — sorun varsa hata metni, yoksa null döner. */
export function checkDumpSanity(dumpBytes) {
  if (!Number.isFinite(dumpBytes) || dumpBytes <= 0) return 'dump üretilemedi (0 byte)';
  if (dumpBytes < MIN_DUMP_BYTES) return `dump şüpheli küçük (${dumpBytes} byte < ${MIN_DUMP_BYTES})`;
  return null;
}

/**
 * Yedekten ÖNCE disk alanı kontrolü: mevcut en büyük arşivin 2 katı + 256 MB
 * tampon ya da en az 1 GB — hangisi büyükse o kadar alan ister.
 */
export function requiredFreeBytes(largestExistingBytes = 0) {
  return Math.max(largestExistingBytes * 2 + 256 * 1024 * 1024, 1024 * 1024 * 1024);
}

// ==================== GFS ROTASYONU ====================

/**
 * GFS (Grandfather-Father-Son) seçimi: hangi yedeklerin SAKLANACAğını döner.
 *
 * - `daily`  : son N ayri günün en yeni yedeği
 * - `weekly` : son N ayri ISO haftasının (Pazartesi başlangıç) en yeni yedeği
 * - `monthly`: son N ayri ayın en yeni yedeği
 * - Kümeler kesişebilir (aynı yedek hem günlük hem haftalık olabilir) — UNION saklanır.
 * - EN YENİ yedek her koşulda saklanır: "son başarılı yedek hiçbir koşulda silinmez".
 *
 * `entries`: [{ key: string, stamp: Date }] — dönen değer saklanacak `key`lerin Set'i.
 * Yalnızca `stale` olarak işaretlenenler silinir; `minKeepCount` adetten az kayıt
 * varsa hiçbir şey silinmez (yeni kurulumda boş geçmişi budamayalım).
 */
export function selectGfsKeep(entries, retention, now = new Date()) {
  const { daily = 7, weekly = 4, monthly = 6 } = retention;
  const sorted = [...entries].sort((a, b) => b.stamp.getTime() - a.stamp.getTime());
  const keep = new Set();
  if (sorted.length === 0) return keep;
  keep.add(sorted[0].key); // son başarılı yedek asla silinmez

  const seenDays = new Set();
  const seenWeeks = new Set();
  const seenMonths = new Set();
  for (const entry of sorted) {
    const d = entry.stamp;
    const dayKey = d.toISOString().slice(0, 10);
    // ISO hafta: Pazartesi başlangıçlı hafta numarası
    const weekKey = isoWeekKey(d);
    const monthKey = d.toISOString().slice(0, 7);
    if (seenDays.size < daily) seenDays.add(dayKey);
    if (seenWeeks.size < weekly) seenWeeks.add(weekKey);
    if (seenMonths.size < monthly) seenMonths.add(monthKey);
    if (seenDays.has(dayKey) || seenWeeks.has(weekKey) || seenMonths.has(monthKey)) {
      keep.add(entry.key);
    }
  }
  return keep;
}

function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // Pazar = 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
