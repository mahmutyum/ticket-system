import { buildApp } from './app.js';
import { config } from './config/index.js';
import { slaCheckQueue } from './jobs/queue.js';
import { warmTicketCounter } from './utils/ticket-number.js';

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
