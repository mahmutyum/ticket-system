import { buildApp } from './app.js';
import { config } from './config/index.js';
import { closeQueues } from './jobs/queue.js';
import { syncSchedules } from './jobs/scheduler.js';
import { warmTicketCounter } from './utils/ticket-number.js';
import { ensureTaskEmailTemplates } from './modules/tasks/task-templates.js';
import { ensureSystemEmailTemplates } from './jobs/notification-templates.js';
import { prisma } from './db.js';

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

    // Operasyonel uyku halleri: bu ayarlar sessizce "kapalı/düşük korumalı"
    // davranış üretir, kimse fark etmez. Açılışta yüksek sesle uyar.
    if (config.NODE_ENV === 'production') {
      if (!config.METRICS_TOKEN) {
        app.log.warn('METRICS_TOKEN tanımsız — /metrics kapalı (404). Prometheus izlemesi sessizce veri almıyor olabilir.');
      }
      if (config.ENABLE_API_DOCS) {
        app.log.warn('ENABLE_API_DOCS=true ve NODE_ENV=production — /docs internete açık kurulumlarda kapatılmalı (bkz. docs/operasyon.md).');
      }
    }

    // Warm ticket counter so cold starts don't pay seed cost on first ticket
    try {
      await warmTicketCounter();
      app.log.info('Ticket counter warmed for current year');
    } catch (err) {
      app.log.warn({ err }, 'Failed to warm ticket counter — will seed on first ticket');
    }

    // Ensure task email templates exist (idempotent — only creates if missing).
    // Paylaşılan db.ts singleton'ı kullanılır: ikinci bir PrismaClient örneklemek
    // ayrı bir bağlantı havuzu açar ve kapanış sırasını karmaşıklaştırır.
    try {
      await ensureTaskEmailTemplates(prisma);
      await ensureSystemEmailTemplates(prisma);
      app.log.info('Task and system email templates ensured');
    } catch (err) {
      app.log.warn({ err }, 'Failed to ensure task email templates');
    }

    // Zamanlanmış görevler (v1.2): registry DB'den okunur, BullMQ
    // scheduler'ları upsert edilir. İlk açılışta ScheduledJob kayıtları
    // varsayılanlarla oluşur; sonraki açılışlarda paneldeki cron/enabled
    // tercihleri geçerlidir. Eksik/bozuk cron görevleri atlanır ve
    // loglanır — açılış düşmez.
    await syncSchedules();
    app.log.info('Scheduled jobs synced from registry');

  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// start() kendi try/catch'i içinde process.exit(1) yapar; void ile "bilinçli
// olarak beklemiyorum" işaretlenir — aksi halde floating promise uyarısı verir.
void start();
