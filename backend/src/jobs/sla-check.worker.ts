import { Worker } from 'bullmq';
import { queueEmail, redisConnection } from './queue.js';
import { prisma } from '../db.js';
import { broadcastToStaff, broadcastToTicket } from '../services/sse.service.js';
import { runSlaCheck } from './sla-check.js';
import { runAutoClose } from './auto-close.js';

/**
 * Periyodik ticket bakım işleri (`sla-check` kuyruğu):
 * - `sla-check`  → her 5 dk; SLA uyarı / ihlal / eskalasyon
 * - `auto-close` → her 15 dk; otomatik kapatma ve bekleme hatırlatması
 */
export const slaCheckWorker = new Worker(
  'sla-check',
  async (job) => {
    if (job.name === 'auto-close') {
      const result = await runAutoClose(prisma, new Date(), {
        queueEmail,
        broadcastStaff: broadcastToStaff,
        broadcastTicket: broadcastToTicket,
      });
      console.log(`[Auto Close] ${result.closed} closed, ${result.reminded} reminded`);
      return;
    }
    const result = await runSlaCheck(prisma, new Date(), { queueEmail, broadcast: broadcastToStaff });
    console.log(
      `[SLA Check] ${result.breaches} breaches, ${result.warnings} warnings, ${result.escalations} escalations`,
    );
  },
  { connection: redisConnection },
);

export default slaCheckWorker;
