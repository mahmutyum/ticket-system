/**
 * CREDENTIALS_ENC_KEY rotasyonu.
 *
 * `CREDENTIALS_ENC_KEY` ile şifrelenmiş TÜM sütunları eski anahtarla çözer, yeni
 * anahtarla yeniden şifreler. Şifrelenen alanlar (tek doğruluk kaynağı burasıdır —
 * yeni bir şifreli sütun eklendiğinde bu listeye de eklenmeli):
 *   - credential_entries.password_enc  (zorunlu)
 *   - credential_entries.notes_enc     (opsiyonel)
 *   - staff.mfa_secret_enc             (opsiyonel — MFA kurmuş personel)
 *   - company_smtp.pass                (yalnızca şifreliyse; düz metin dokunulmaz)
 *
 * Neden ayrı bir script: `utils/crypto.ts` anahtarı tek bir env'den (getKey) okur,
 * yani aynı anda iki anahtar tutamaz. Burada çöz/şifrele fonksiyonları anahtarı
 * PARAMETRE alır, böylece eski→yeni geçiş tek process içinde yapılabilir.
 *
 * Kullanım:
 *   CREDENTIALS_ENC_KEY_OLD=<eski64hex> \
 *   CREDENTIALS_ENC_KEY=<yeni64hex> \
 *   docker compose exec backend npx tsx prisma/scripts/rotate-credentials-key.ts [--commit]
 *
 * --commit olmadan KURU ÇALIŞMA yapar (hiçbir şey yazılmaz), sadece kaç kayıt
 * etkileneceğini raporlar. Önce kuru çalıştır, sayıları doğrula, sonra --commit.
 *
 * ADIMLAR (öneri):
 *   1) Yeni anahtar üret:  openssl rand -hex 32
 *   2) Yedek al (DB dump).
 *   3) Bu script'i --commit ile çalıştır (OLD=mevcut, yeni=hedef).
 *   4) .env'de CREDENTIALS_ENC_KEY'i yeni değere çevir, backend'i yeniden başlat.
 *   5) Bir kayıt "reveal" edip doğrula.
 */
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const ALGO = 'aes-256-gcm';

function keyFromEnv(name: string): Buffer {
  const hex = process.env[name];
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`${name} 64 karakterlik hex (32 byte) olmalı`);
  }
  return Buffer.from(hex, 'hex');
}

function looksEncrypted(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  const [ivB64, tagB64, dataB64] = parts;
  if (!ivB64 || !tagB64 || !dataB64) return false;
  try {
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    if (iv.toString('base64') !== ivB64 || tag.toString('base64') !== tagB64) return false;
    return iv.length === 12 && tag.length === 16;
  } catch {
    return false;
  }
}

function decryptWith(key: Buffer, payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Geçersiz şifreli veri formatı');
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

function encryptWith(key: Buffer, plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/** Eski anahtarla çöz, yeni anahtarla şifrele. Anahtar yanlışsa GCM tag doğrulaması patlar. */
function reencrypt(oldKey: Buffer, newKey: Buffer, payload: string): string {
  return encryptWith(newKey, decryptWith(oldKey, payload));
}

async function main() {
  const commit = process.argv.includes('--commit');
  const oldKey = keyFromEnv('CREDENTIALS_ENC_KEY_OLD');
  const newKey = keyFromEnv('CREDENTIALS_ENC_KEY');

  if (Buffer.compare(oldKey, newKey) === 0) {
    throw new Error('CREDENTIALS_ENC_KEY_OLD ve CREDENTIALS_ENC_KEY aynı — rotasyona gerek yok');
  }

  const prisma = new PrismaClient();
  const stats = { credentials: 0, notes: 0, mfa: 0, smtp: 0, skipped: 0 };

  try {
    // --- credential_entries ---
    const entries = await prisma.credentialEntry.findMany({
      select: { id: true, passwordEnc: true, notesEnc: true },
    });
    for (const e of entries) {
      const data: { passwordEnc?: string; notesEnc?: string } = {};
      data.passwordEnc = reencrypt(oldKey, newKey, e.passwordEnc);
      stats.credentials++;
      if (e.notesEnc) {
        data.notesEnc = reencrypt(oldKey, newKey, e.notesEnc);
        stats.notes++;
      }
      if (commit) await prisma.credentialEntry.update({ where: { id: e.id }, data });
    }

    // --- staff.mfaSecretEnc ---
    const staffWithMfa = await prisma.staff.findMany({
      where: { mfaSecretEnc: { not: null } },
      select: { id: true, mfaSecretEnc: true },
    });
    for (const s of staffWithMfa) {
      const next = reencrypt(oldKey, newKey, s.mfaSecretEnc!);
      stats.mfa++;
      if (commit) await prisma.staff.update({ where: { id: s.id }, data: { mfaSecretEnc: next } });
    }

    // --- company_smtp.pass (yalnızca şifreli olanlar; düz metin ayrı migration'a ait) ---
    const smtps = await prisma.companySmtp.findMany({ select: { id: true, pass: true } });
    for (const smtp of smtps) {
      if (!looksEncrypted(smtp.pass)) {
        stats.skipped++;
        continue;
      }
      const next = reencrypt(oldKey, newKey, smtp.pass);
      stats.smtp++;
      if (commit) await prisma.companySmtp.update({ where: { id: smtp.id }, data: { pass: next } });
    }

    console.log(commit ? '✔ Rotasyon UYGULANDI' : '🔎 KURU ÇALIŞMA (yazılmadı) — --commit ile uygula');
    console.log(
      `  credentials: ${stats.credentials}, notes: ${stats.notes}, mfa: ${stats.mfa}, ` +
      `smtp(şifreli): ${stats.smtp}, smtp(düz metin, atlandı): ${stats.skipped}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Rotasyon başarısız:', err instanceof Error ? err.message : err);
  process.exit(1);
});
