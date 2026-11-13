import type { PrismaClient } from '@prisma/client';

/**
 * Veri saklama (retention) politikası — v1.2'de CLI'dan ayrılıp servis olarak
 * taşındı: hem `prisma/scripts/retention.ts` (elle çalıştırma) hem de
 * zamanlanmış `retention-check` görevi aynı kodu kullanır.
 *
 * Davranış ilkesi korunur: CHECK yalnızca rapor üretir; APPLY yıkıcıdır ve
 * bilinçli olarak otomatik zamanlanmaz — insan onayı + güncel yedek şarttır.
 */

export interface RetentionReport {
  cutoff: Date;
  files: number;
  bytes: number;
}

/**
 * Saklama süresini geçmiş, kapanmış/çözülmüş ticket'ların eklerini raporlar.
 * Uygulama (`--apply`) yalnızca CLI script'inde yapılır.
 */
export async function checkRetention(
  prisma: Pick<PrismaClient, 'attachment'>,
  days = Number(process.env.RETENTION_CLOSED_TICKET_DAYS ?? 365),
): Promise<RetentionReport> {
  if (!Number.isInteger(days) || days < 30) {
    throw new Error('RETENTION_CLOSED_TICKET_DAYS en az 30 olan bir tam sayı olmalı');
  }
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const attachments = await prisma.attachment.findMany({
    where: {
      ticket: {
        status: { in: ['resolved', 'closed'] },
        closedAt: { lt: cutoff },
      },
    },
    select: { fileSize: true },
  });
  return {
    cutoff,
    files: attachments.length,
    bytes: attachments.reduce((sum, item) => sum + item.fileSize, 0),
  };
}
