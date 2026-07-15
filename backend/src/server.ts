import { buildApp } from './app.js';
import { config } from './config/index.js';
import { slaCheckQueue } from './jobs/queue.js';
import { warmTicketCounter } from './utils/ticket-number.js';
import { ensureTaskEmailTemplates } from './modules/tasks/task-templates.js';
import { PrismaClient } from '@prisma/client';

// Import workers to start them
import './jobs/email.worker.js';
import './jobs/sms.worker.js';
import './jobs/sla-check.worker.js';

async function start() {
  const app = await buildApp();

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
      await prisma.$disconnect();
      app.log.info('Task email templates ensured');
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
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
