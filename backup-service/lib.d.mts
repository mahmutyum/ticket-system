/**
 * backup/lib.mjs tip bildirimi — yedekleme servisinin SAF yardımcıları.
 * Uygulama JavaScript'tir (backup imajı TypeScript derlemez); format
 * backend/src/utils/crypto.ts ile birebir ortaktır.
 */

/** "iv:authTag:cipher" (base64) formatını AES-256-GCM ile çözer. */
export declare function decryptPayload(payload: string, keyHex: string): string;

/** configEnc'i çözümler; remote adı `target` olmalıdır. */
export declare function parseTargetConfig(
  configEnc: string,
  keyHex: string,
): { remote: 'target'; ini: string };

/** INI metnindeki endpoint/url/host değerlerini çıkarır (SSRF denetimi için). */
export declare function extractHostsFromIni(ini: string): string[];

/** Şüpheli küçük dump eşiği (byte). */
export declare const MIN_DUMP_BYTES: number;

/** Dump boyutu sağduyu kontrolü — sorun varsa hata metni, yoksa null. */
export declare function checkDumpSanity(dumpBytes: number): string | null;

/** Yedekten önce istenen serbest disk alanı (byte). */
export declare function requiredFreeBytes(largestExistingBytes?: number): number;

/** GFS (günlük/haftalık/aylık) rotasyonunda SAKLANACAK yedek anahtarlarını seçer. */
export declare function selectGfsKeep(
  entries: Array<{ key: string; stamp: Date }>,
  retention: { daily?: number; weekly?: number; monthly?: number },
  now?: Date,
): Set<string>;
