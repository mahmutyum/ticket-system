/**
 * Tek seferlik geçiş: `CompanySmtp.pass` alanındaki düz metin şifreleri
 * AES-256-GCM ile şifreler.
 *
 * `CompanySmtp.pass` eskiden düz metin saklanıyordu (şemadaki
 * "// encrypted in production" yorumu gerçeği yansıtmıyordu). Yazma yolu artık
 * şifreliyor; bu script mevcut kayıtları geçirir.
 *
 * Çalıştır:
 *   docker compose exec backend npx tsx prisma/scripts/encrypt-smtp-passwords.ts
 *
 * Idempotent'tir: zaten şifreli kayıtlara dokunmaz, tekrar tekrar çalıştırılabilir.
 *
 * ÖNCE VERİTABANI YEDEĞİ AL. CREDENTIALS_ENC_KEY kaybolursa bu şifreler
 * kurtarılamaz.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { encrypt, looksEncrypted } from '../../src/utils/crypto.js';

// Prisma 7: pg driver adapter zorunlu — config modülü yüklenmez (bkz. prisma/seed.ts).
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  if (!process.env.CREDENTIALS_ENC_KEY) {
    console.error('CREDENTIALS_ENC_KEY tanımlı değil — şifreleme yapılamaz.');
    process.exit(1);
  }

  const rows = await prisma.companySmtp.findMany({
    select: { id: true, companyId: true, pass: true, company: { select: { name: true } } },
  });

  if (rows.length === 0) {
    console.log('Şirket bazlı SMTP kaydı yok — yapılacak bir şey yok.');
    return;
  }

  let encrypted = 0;
  let skipped = 0;

  for (const row of rows) {
    if (looksEncrypted(row.pass)) {
      skipped++;
      console.log(`  atlandı (zaten şifreli): ${row.company.name}`);
      continue;
    }

    await prisma.companySmtp.update({
      where: { id: row.id },
      data: { pass: encrypt(row.pass) },
    });
    encrypted++;
    console.log(`  şifrelendi: ${row.company.name}`);
  }

  console.log(`\nTamamlandı — ${encrypted} şifrelendi, ${skipped} zaten şifreliydi.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
