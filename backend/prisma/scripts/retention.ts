import { prisma } from '../../src/db.js';
import { checkRetention } from '../../src/services/retention.js';
import { deleteFile } from '../../src/services/storage.service.js';

/**
 * Retention CLI — yalnızca elle çalıştırılır. Check otomatik zamanlanabilir
 * (`retention-check` görevi, aynı checkRetention servis kodu); APPLY ise
 * bilinçli olarak ASLA otomatik zamanlanmaz: insan onayı + güncel yedek şart.
 */
const days = Number(process.env.RETENTION_CLOSED_TICKET_DAYS ?? 365);
const apply = process.argv.includes('--apply');

async function main() {
  const report = await checkRetention(prisma, days);
  const cutoff = report.cutoff.toISOString();
  console.log(JSON.stringify({ apply, cutoff, files: report.files, bytes: report.bytes }));
  if (!apply) return;

  // Silme listesi id'leriyle alınır; servis yalnızca RAPOR üretir (yıkıcı
  // işlemler tek yerde, CLI'da kalır).
  const attachments = await prisma.attachment.findMany({
    where: {
      ticket: {
        status: { in: ['resolved', 'closed'] },
        closedAt: { lt: new Date(cutoff) },
      },
    },
    select: { id: true, filePath: true },
  });
  for (const attachment of attachments) {
    await deleteFile(attachment.filePath);
    await prisma.attachment.delete({ where: { id: attachment.id } });
  }
}

main()
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
