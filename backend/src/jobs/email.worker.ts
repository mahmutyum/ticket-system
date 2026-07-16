import { Worker } from 'bullmq';
import { sendEmailForCompany, renderHtmlTemplate, renderTextTemplate, renderSubjectTemplate } from '../services/email.service.js';
import { prisma } from '../db.js';
import { redisConnection } from './queue.js';
import type { EmailJobData } from './queue.js';

export const emailWorker = new Worker<EmailJobData>(
  'email',
  async (job) => {
    const { to, templateSlug, variables, ticketId, companyId } = job.data;

    const template = await prisma.emailTemplate.findUnique({
      where: { slug: templateSlug },
    });

    if (!template) {
      throw new Error(`Email template not found: ${templateSlug}`);
    }

    // Her bağlam kendi kaçışlamasını ister: konu başlıktır (CR/LF temizlenir),
    // gövde HTML'dir (kaçışlanır), düz metin gövde ham kalır.
    const subject = renderSubjectTemplate(template.subject, variables);
    const html = renderHtmlTemplate(template.bodyHtml, variables);
    const text = renderTextTemplate(template.bodyText, variables);

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

    await sendEmailForCompany({ to, subject, html, text }, companyId || null, companySmtp);

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
  })().catch((e: unknown) => console.error('[Email Worker] failed-handler hatası:', e));
});

emailWorker.on('completed', (job) => {
  console.log(`[Email Worker] Job ${job.id} completed`);
});

export default emailWorker;
