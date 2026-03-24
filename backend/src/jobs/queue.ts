import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config/index.js';

const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

export const emailQueue = new Queue('email', { connection });
export const smsQueue = new Queue('sms', { connection });
export const slaCheckQueue = new Queue('sla-check', { connection });

export interface EmailJobData {
  to: string;
  templateSlug: string;
  variables: Record<string, string>;
  ticketId?: string;
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
