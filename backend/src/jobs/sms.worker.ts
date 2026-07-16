import { Worker } from 'bullmq';
import { prisma } from '../db.js';
import { redisConnection } from './queue.js';
import type { SmsJobData } from './queue.js';
import { isFinalAttempt, processSmsJob } from './processors.js';

export const smsWorker = new Worker<SmsJobData>(
  'sms',
  async (job) => processSmsJob(job.data, prisma),
  {
    connection: redisConnection,
    concurrency: 3,
  },
);

// EventEmitter async handler'ın reddini yakalamaz — bkz. email.worker.ts.
smsWorker.on('failed', (job, err) => {
  void (async () => {
    console.error(`[SMS Worker] Job ${job?.id} failed:`, err.message);

    if (job && isFinalAttempt(job.attemptsMade, job.opts.attempts)) {
      await prisma.notification.create({
        data: {
          ticketId: job.data.ticketId || null,
          type: 'sms',
          channel: job.data.templateSlug,
          recipient: job.data.to,
          body: '',
          status: 'failed',
          errorMsg: err.message,
        },
      });
    }
  })().catch((e: unknown) => console.error('[SMS Worker] failed-handler hatası:', e));
});

export default smsWorker;
