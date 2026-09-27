import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config/index.js';

export const redisConnection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

export const emailQueue = new Queue('email', { connection: redisConnection });
export const smsQueue = new Queue('sms', { connection: redisConnection });
export const slaCheckQueue = new Queue('sla-check', { connection: redisConnection });
export const mailFetchQueue = new Queue('mail-fetch', { connection: redisConnection });
export const webhookQueue = new Queue('webhook', { connection: redisConnection });

/** Webhook teslimatını kuyruğa atar: 5 deneme, üstel bekleme (10 sn → ~2.7 dk). */
export async function queueWebhookDelivery(deliveryId: string) {
  await webhookQueue.add('deliver', { deliveryId }, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: 500,
    removeOnFail: 500,
  });
}

export interface EmailJobData {
  to: string;
  templateSlug: string;
  variables: Record<string, string>;
  ticketId?: string;
  companyId?: string; // Used to resolve company-specific SMTP
}

export interface SmsJobData {
  to: string;
  templateSlug: string;
  variables: Record<string, string>;
  ticketId?: string;
}

/**
 * Enqueue an email notification
 */
export async function queueEmail(data: EmailJobData) {
  await emailQueue.add('send-email', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  });
}

/**
 * Enqueue an SMS notification
 */
export async function queueSms(data: SmsJobData) {
  await smsQueue.add('send-sms', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  });
}

export async function closeQueues(): Promise<void> {
  await Promise.all([
    emailQueue.close(),
    smsQueue.close(),
    slaCheckQueue.close(),
    mailFetchQueue.close(),
    webhookQueue.close(),
  ]);
  await redisConnection.quit();
}
