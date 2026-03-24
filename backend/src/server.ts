import { buildApp } from './app.js';
import { config } from './config/index.js';
import { slaCheckQueue } from './jobs/queue.js';

// Import workers to start them
import './jobs/email.worker.js';
import './jobs/sms.worker.js';
import './jobs/sla-check.worker.js';

async function start() {
  const app = await buildApp();

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    app.log.info(`Server running on port ${config.PORT}`);

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
