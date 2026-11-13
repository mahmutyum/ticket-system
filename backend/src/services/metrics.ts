import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import type { Queue } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { getClientCount } from './sse.service.js';

/**
 * Prometheus metrikleri.
 *
 * Pahalı değerler (kuyruk derinliği, DB sayımları) yalnızca scrape anında
 * hesaplanır (`collect`) — istek yolunda ek maliyet yoktur. HTTP etiketlerinde ham
 * URL DEĞİL route şablonu kullanılır (`/tickets/:id`), aksi hâlde her ticket id'si
 * yeni bir zaman serisi açardı (kardinalite patlaması).
 */

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'ticket_' });

export const httpDuration = new Histogram({
  name: 'ticket_http_request_duration_seconds',
  help: 'HTTP istek süresi (saniye)',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const httpErrors = new Counter({
  name: 'ticket_http_errors_total',
  help: '5xx yanıt sayısı',
  labelNames: ['method', 'route'] as const,
  registers: [registry],
});

let collectorsRegistered = false;

/** Scrape anında hesaplanan göstergeler. Tekrar çağrılırsa (testlerde birden çok app) yok sayılır. */
export function registerCollectors(prisma: PrismaClient, queues: Record<string, Queue>): void {
  if (collectorsRegistered) return;
  collectorsRegistered = true;
  new Gauge({
    name: 'ticket_queue_jobs',
    help: 'BullMQ kuyruğundaki iş sayısı (duruma göre)',
    labelNames: ['queue', 'state'] as const,
    registers: [registry],
    async collect() {
      this.reset();
      for (const [name, queue] of Object.entries(queues)) {
        const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
        for (const [state, count] of Object.entries(counts)) this.set({ queue: name, state }, count);
      }
    },
  });

  new Gauge({
    name: 'ticket_notifications_failed',
    help: 'Kalıcı olarak başarısız bildirim sayısı (e-posta/SMS)',
    labelNames: ['type'] as const,
    registers: [registry],
    async collect() {
      this.reset();
      const rows = await prisma.notification.groupBy({ by: ['type'], where: { status: 'failed' }, _count: true });
      for (const row of rows) this.set({ type: row.type }, row._count);
    },
  });

  new Gauge({
    name: 'ticket_sla_breaches_open',
    help: 'SLA ihlali kaydedilmiş, henüz çözülmemiş ticket sayısı',
    labelNames: ['kind'] as const,
    registers: [registry],
    async collect() {
      const open = { status: { notIn: ['resolved' as const, 'closed' as const] } };
      const [response, resolution] = await Promise.all([
        prisma.ticket.count({ where: { ...open, slaResponseMet: false } }),
        prisma.ticket.count({ where: { ...open, slaResolveMet: false } }),
      ]);
      this.set({ kind: 'response' }, response);
      this.set({ kind: 'resolution' }, resolution);
    },
  });

  new Gauge({
    name: 'ticket_open_tickets',
    help: 'Açık (çözülmemiş) ticket sayısı',
    registers: [registry],
    async collect() {
      this.set(await prisma.ticket.count({ where: { status: { notIn: ['resolved', 'closed'] } } }));
    },
  });

  new Gauge({
    name: 'ticket_webhook_deliveries_failed',
    help: 'Son 24 saatte başarısız webhook teslimatı',
    registers: [registry],
    async collect() {
      this.set(await prisma.webhookDelivery.count({ where: { status: 'failed', createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }));
    },
  });

  new Gauge({
    name: 'ticket_mailbox_errors',
    help: 'Son çekmede hata veren aktif gelen posta kutusu sayısı',
    registers: [registry],
    async collect() {
      this.set(await prisma.companyMailbox.count({ where: { isActive: true, lastError: { not: null } } }));
    },
  });

  new Gauge({
    name: 'ticket_sse_connections',
    help: 'Açık SSE bağlantıları',
    labelNames: ['type'] as const,
    registers: [registry],
    collect() {
      const counts = getClientCount();
      this.set({ type: 'staff' }, counts.staff);
      this.set({ type: 'public' }, counts.public);
    },
  });

  new Gauge({
    // operasyon.md'deki "son başarılı backup 26 saatten eski" alarmı bu
    // metrikle otomatik izlenir (v1.2). Değer Unix saniye cinsinden son
    // başarılı yedek zamanı; hiç yedek yoksa 0 — `== 0` alarmı da yakalar.
    name: 'ticket_backup_last_success_timestamp',
    help: 'Son başarılı yedeğin Unix zaman damgası (saniye; yedek yoksa 0)',
    registers: [registry],
    async collect() {
      const [latest] = await prisma.$queryRaw<Array<{ ts: Date | null }>>`
        SELECT max(ts) AS ts FROM (
          SELECT last_success_at AS ts FROM backup_targets
          UNION ALL
          SELECT max(finished_at) AS ts FROM scheduled_job_runs WHERE job_key = 'backup' AND status = 'ok'
        ) t
      `;
      this.set(latest?.ts ? Math.floor(latest.ts.getTime() / 1000) : 0);
    },
  });
}
