import { Worker } from 'bullmq';
import { redisConnection } from './queue.js';
import { prisma } from '../db.js';
import { deliverWebhook } from '../services/webhooks/dispatch.js';

export const webhookWorker = new Worker(
  'webhook',
  async (job) => {
    await deliverWebhook(prisma, (job.data as { deliveryId: string }).deliveryId);
  },
  { connection: redisConnection, concurrency: 5 },
);

export default webhookWorker;
