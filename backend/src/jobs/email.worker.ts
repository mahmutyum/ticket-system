import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { sendEmailForCompany, renderTemplate } from '../services/email.service.js';
import { config } from '../config/index.js';
import type { EmailJobData } from './queue.js';

const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
const prisma = new PrismaClient();

const emailWorker = new Worker<EmailJobData>(
  'email',
  async (job) => {
    const { to, templateSlug, variables, ticketId, companyId } = job.data;

    // Fetch email template from DB
    const template = await prisma.emailTemplate.findUnique({
      where: { slug: templateSlug },
    });

    if (!template) {
      throw new Error(`Email template not found: ${templateSlug}`);
    }

    const subject = renderTemplate(template.subject, variables);
    const html = renderTemplate(template.bodyHtml, variables);
    const text = renderTemplate(template.bodyText, variables);

    // Resolve company SMTP config (if companyId provided)
    let companySmtp = null;
    if (companyId) {
      const smtpRecord = await prisma.companySmtp.findUnique({
        where: { companyId },
      });
      if (smtpRecord && smtpRecord.isActive) {
        companySmtp = {
          host: smtpRecord.host,
          port: smtpRecord.port,
          secure: smtpRecord.secure,
          user: smtpRecord.user,
          pass: smtpRecord.pass,
          fromName: smtpRecord.fromName,
          fromEmail: smtpRecord.fromEmail,
        };
      }
    }

    // Send using company SMTP or fallback to global
    await sendEmailForCompany({ to, subject, html, text }, companyId || null, companySmtp);

    // Record notification
    await prisma.notification.create({
      data: {
        ticketId: ticketId || null,
        type: 'email',
        channel: templateSlug,
        recipient: to,
        subject,
        body: text,
        status: 'sent',
        sentAt: new Date(),
      },
    });

    const smtpSource = companySmtp ? `company(${companyId})` : 'global';
    console.log(`[Email Worker] Sent "${templateSlug}" to ${to} via ${smtpSource}`);
  },
  {
    connection,
    concurrency: 5,
  },
);

emailWorker.on('failed', async (job, err) => {
  console.error(`[Email Worker] Job ${job?.id} failed:`, err.message);

  if (job && job.attemptsMade >= (job.opts.attempts || 3)) {
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
});

emailWorker.on('completed', (job) => {
  console.log(`[Email Worker] Job ${job.id} completed`);
});

export default emailWorker;
