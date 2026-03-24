import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { sendSms } from '../services/sms.service.js';
import { config } from '../config/index.js';
import type { SmsJobData } from './queue.js';

const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
const prisma = new PrismaClient();

const smsWorker = new Worker<SmsJobData>(
  'sms',
  async (job) => {
    const { to, templateSlug, variables, ticketId } = job.data;

    // Fetch SMS template
    const template = await prisma.smsTemplate.findUnique({
      where: { slug: templateSlug },
    });

    if (!template) {
      throw new Error(`SMS template not found: ${templateSlug}`);
    }

    // Render template
    let body = template.body;
    for (const [key, value] of Object.entries(variables)) {
      body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value ?? '');
    }

    await sendSms({ to, body });

    // Record notification
    await prisma.notification.create({
      data: {
        ticketId: ticketId || null,
        type: 'sms',
        channel: templateSlug,
        recipient: to,
        body,
        status: 'sent',
        sentAt: new Date(),
      },
    });

    console.log(`[SMS Worker] Sent "${templateSlug}" to ${to}`);
  },
  {
    connection,
    concurrency: 3,
  },
);

smsWorker.on('failed', async (job, err) => {
  console.error(`[SMS Worker] Job ${job?.id} failed:`, err.message);

  if (job && job.attemptsMade >= (job.opts.attempts || 3)) {
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
});

export default smsWorker;
