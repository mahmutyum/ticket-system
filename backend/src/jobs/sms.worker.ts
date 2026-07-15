import { Worker } from 'bullmq';
import { sendSms } from '../services/sms.service.js';
import { renderTextTemplate } from '../services/email.service.js';
import { prisma } from '../db.js';
import { redisConnection } from './queue.js';
import type { SmsJobData } from './queue.js';

const smsWorker = new Worker<SmsJobData>(
  'sms',
  async (job) => {
    const { to, templateSlug, variables, ticketId } = job.data;

    const template = await prisma.smsTemplate.findUnique({
      where: { slug: templateSlug },
    });

    if (!template) {
      throw new Error(`SMS template not found: ${templateSlug}`);
    }

    // SMS düz metindir — HTML kaçışlaması gerekmez, ama ortak render'ı kullan:
    // inline kopya replacement-string tuzağını ($& $` $') taşıyordu.
    const body = renderTextTemplate(template.body, variables);

    await sendSms({ to, body });

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
    connection: redisConnection,
    concurrency: 3,
  },
);

// EventEmitter async handler'ın reddini yakalamaz — bkz. email.worker.ts.
smsWorker.on('failed', (job, err) => {
  void (async () => {
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
  })().catch((e: unknown) => console.error('[SMS Worker] failed-handler hatası:', e));
});

export default smsWorker;
