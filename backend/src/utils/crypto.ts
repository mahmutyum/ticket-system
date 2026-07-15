import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';

/** Anahtarı çağrı anında process.env'den okur (config'e bağımlı değil — test edilebilir). */
function getKey(): Buffer {
  const hex = process.env.CREDENTIALS_ENC_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('CREDENTIALS_ENC_KEY 64 karakterlik hex (32 byte) olmalı');
  }
  return Buffer.from(hex, 'hex');
}

/** Düz metni AES-256-GCM ile şifreler. Çıktı: "iv:authTag:ciphertext" (base64). */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/** "iv:authTag:ciphertext" formatındaki payload'ı çözer. Bozuksa hata fırlatır. */
export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Geçersiz şifreli veri formatı');
  const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}
