import { Worker } from 'bullmq';
import { queueEmail, queueSms, redisConnection } from './queue.js';
import { prisma } from '../db.js';
import { broadcastToStaff } from '../services/sse.service.js';
import { runMailFetch } from './mail-fetch.js';

// concurrency 1: bir tur bitmeden diğeri başlamaz (IMAP bağlantısı / çift işleme).
export const mailFetchWorker = new Worker(
  'mail-fetch',
  async () => {
    const result = await runMailFetch(prisma, new Date(), { queueEmail, queueSms, broadcastStaff: broadcastToStaff });
    if (result.mailboxes > 0) {
      console.log(`[Mail Fetch] ${result.mailboxes} mailboxes, ${result.processed} messages, ${result.failedMailboxes} failed`);
    }
  },
  { connection: redisConnection, concurrency: 1 },
);

export default mailFetchWorker;
