import { prisma } from '../../src/db.js';
import { deleteFile } from '../../src/services/storage.service.js';

const days = Number(process.env.RETENTION_CLOSED_TICKET_DAYS ?? 365);
const apply = process.argv.includes('--apply');

if (!Number.isInteger(days) || days < 30) {
  throw new Error('RETENTION_CLOSED_TICKET_DAYS en az 30 olan bir tam sayı olmalı');
}

const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

async function main() {
  const attachments = await prisma.attachment.findMany({
    where: {
      ticket: {
        status: { in: ['resolved', 'closed'] },
        closedAt: { lt: cutoff },
      },
    },
    select: { id: true, filePath: true, fileSize: true },
  });

  const bytes = attachments.reduce((sum, item) => sum + item.fileSize, 0);
  console.log(JSON.stringify({ apply, cutoff, files: attachments.length, bytes }));
  if (!apply) return;

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
