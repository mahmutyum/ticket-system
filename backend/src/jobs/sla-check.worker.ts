import { Worker } from 'bullmq';
import { queueEmail, redisConnection } from './queue.js';
import { prisma } from '../db.js';
import { broadcastToStaff, broadcastToTicket } from '../services/sse.service.js';
import { runSlaCheck } from './sla-check.js';
import { runAutoClose } from './auto-close.js';
import { checkRetention } from '../services/retention.js';
import { withJobRun } from './scheduler.js';

/**
 * Periyodik ticket bakım işleri (`sla-check` kuyruğu):
 * - `sla-check`        → her 5 dk; SLA uyarı / ihlal / eskalasyon
 * - `auto-close`       → her 15 dk; otomatik kapatma ve bekleme hatırlatması
 * - `retention-check`  → günlük; veri saklama raporu (uygulama yalnızca elle)
 *
 * Her çalışma `withJobRun` ile sarılır: Redis tekil çalışma kilidi + `ScheduledJobRun`
 * kaydı + başarısızlıkta admin e-postası (v1.2 merkezi cron altyapısı). Kilit süreleri
 * görev aralıklarının altında tutulur (5dk görev → 4dk kilit) — üst üste binme
 * engellenir ama bir sonraki tur engellenmez.
 */
export const slaCheckWorker = new Worker(
  'sla-check',
  async (job) => {
    if (job.name === 'auto-close') {
      const result = await withJobRun('auto-close', async () => {
        const r = await runAutoClose(prisma, new Date(), {
          queueEmail,
          broadcastStaff: broadcastToStaff,
          broadcastTicket: broadcastToTicket,
        });
        return `closed=${r.closed} reminded=${r.reminded}`;
      }, { lockTtlSeconds: 14 * 60 });
      if (!result.skipped) console.log(`[Auto Close] ${result.summary ?? result.error}`);
      return;
    }

    if (job.name === 'retention-check') {
      const result = await withJobRun('retention-check', async () => {
        const r = await checkRetention(prisma);
        return `files=${r.files} bytes=${r.bytes} (check-only — apply manuel)`;
      }, { lockTtlSeconds: 4 * 60 });
      if (!result.skipped) console.log(`[Retention Check] ${result.summary ?? result.error}`);
      return;
    }

    const result = await withJobRun('sla-check', async () => {
      const r = await runSlaCheck(prisma, new Date(), { queueEmail, broadcast: broadcastToStaff });
      return `breaches=${r.breaches} warnings=${r.warnings} escalations=${r.escalations}`;
    }, { lockTtlSeconds: 4 * 60 });
    if (!result.skipped) console.log(`[SLA Check] ${result.summary ?? result.error}`);
  },
  { connection: redisConnection },
);

export default slaCheckWorker;
