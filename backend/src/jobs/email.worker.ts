import { Worker } from 'bullmq';
import { prisma } from '../db.js';
import { redisConnection } from './queue.js';
import type { EmailJobData } from './queue.js';
import { isFinalAttempt, processEmailJob } from './processors.js';

export const emailWorker = new Worker<EmailJobData>(
  'email',
  async (job) => processEmailJob(job.data, prisma),
  {
    connection: redisConnection,
    concurrency: 5,
  },
);

// EventEmitter async handler'ın döndürdüğü promise'i beklemez ve reddini
// yakalamaz — reddederse unhandled rejection olur. Bu yüzden gövde bir IIFE'ye
// alınıp catch'leniyor.
emailWorker.on('failed', (job, err) => {
  void (async () => {
    console.error(`[Email Worker] Job ${job?.id} failed:`, err.message);

    if (job && isFinalAttempt(job.attemptsMade, job.opts.attempts)) {
      await prisma.notification.create({
        data: {
          ticketId: job.data.ticketId || null,
          type: 'email',
          channel: job.data.templateSlug,
          recipient: job.data.to,
          subject: job.data.templateSlug,
          body: '',
          status: 'failed',
          errorMsg: err.message,
        },
      });
    }
  })().catch((e: unknown) => console.error('[Email Worker] failed-handler hatası:', e));
});

emailWorker.on('completed', (job) => {
  console.log(`[Email Worker] Job ${job.id} completed`);
});

export default emailWorker;
