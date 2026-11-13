import { Worker } from 'bullmq';
import { queueEmail, queueSms, redisConnection } from './queue.js';
import { prisma } from '../db.js';
import { broadcastToStaff } from '../services/sse.service.js';
import { runMailFetch } from './mail-fetch.js';
import { withJobRun } from './scheduler.js';

// concurrency 1: bir tur bitmeden diğeri başlamaz (IMAP bağlantısı / çift işleme).
export const mailFetchWorker = new Worker(
  'mail-fetch',
  async () => {
    const result = await withJobRun('mail-fetch', async () => {
      const r = await runMailFetch(prisma, new Date(), { queueEmail, queueSms, broadcastStaff: broadcastToStaff });
      if (r.mailboxes > 0) {
        console.log(`[Mail Fetch] ${r.mailboxes} mailboxes, ${r.processed} messages, ${r.failedMailboxes} failed`);
      }
      return `mailboxes=${r.mailboxes} processed=${r.processed} failed=${r.failedMailboxes}`;
    }, { lockTtlSeconds: 60 });
    if (!result.skipped && !result.ok) console.error(`[Mail Fetch] başarısız: ${result.error}`);
  },
  { connection: redisConnection, concurrency: 1 },
);

export default mailFetchWorker;
