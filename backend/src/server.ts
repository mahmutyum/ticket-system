import { buildApp } from './app.js';
import { config } from './config/index.js';
import { closeQueues, mailFetchQueue, slaCheckQueue } from './jobs/queue.js';
import { warmTicketCounter } from './utils/ticket-number.js';
import { ensureTaskEmailTemplates } from './modules/tasks/task-templates.js';
import { ensureSystemEmailTemplates } from './jobs/notification-templates.js';
import { PrismaClient } from '@prisma/client';

// Import workers to start them
import { emailWorker } from './jobs/email.worker.js';
import { smsWorker } from './jobs/sms.worker.js';
import { slaCheckWorker } from './jobs/sla-check.worker.js';
import { mailFetchWorker } from './jobs/mail-fetch.worker.js';
import { webhookWorker } from './jobs/webhook.worker.js';

async function start() {
  const app = await buildApp();
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'Graceful shutdown started');
    const forceExit = setTimeout(() => {
      app.log.error('Graceful shutdown timed out');
      process.exit(1);
    }, 30_000);
    forceExit.unref();
    try {
      await app.close();
      await Promise.all([emailWorker.close(), smsWorker.close(), slaCheckWorker.close(), mailFetchWorker.close(), webhookWorker.close()]);
      await closeQueues();
      clearTimeout(forceExit);
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Graceful shutdown failed');
      process.exit(1);
    }
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    app.log.info(`Server running on port ${config.PORT}`);

    // Warm ticket counter so cold starts don't pay seed cost on first ticket
    try {
      await warmTicketCounter();
      app.log.info('Ticket counter warmed for current year');
    } catch (err) {
      app.log.warn({ err }, 'Failed to warm ticket counter — will seed on first ticket');
    }

    // Ensure task email templates exist (idempotent — only creates if missing)
    try {
      const prisma = new PrismaClient();
      await ensureTaskEmailTemplates(prisma);
      await ensureSystemEmailTemplates(prisma);
      await prisma.$disconnect();
      app.log.info('Task and system email templates ensured');
    } catch (err) {
      app.log.warn({ err }, 'Failed to ensure task email templates');
    }

    // Schedule SLA check every 5 minutes
    await slaCheckQueue.upsertJobScheduler(
      'sla-periodic-check',
      { every: 5 * 60 * 1000 },
      { name: 'sla-check' },
    );
    app.log.info('SLA check scheduler started (every 5 min)');

    // Otomatik kapatma / bekleme hatırlatması — aynı kuyrukta, 15 dakikada bir.
    await slaCheckQueue.upsertJobScheduler(
      'ticket-auto-close',
      { every: 15 * 60 * 1000 },
      { name: 'auto-close' },
    );
    app.log.info('Auto-close scheduler started (every 15 min)');

    // Gelen posta kutuları (e-postayla yanıt) — 2 dakikada bir.
    await mailFetchQueue.upsertJobScheduler(
      'mail-periodic-fetch',
      { every: 2 * 60 * 1000 },
      { name: 'mail-fetch' },
    );
    app.log.info('Mail fetch scheduler started (every 2 min)');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// start() kendi try/catch'i içinde process.exit(1) yapar; void ile "bilinçli
// olarak beklemiyorum" işaretlenir — aksi halde floating promise uyarısı verir.
void start();
