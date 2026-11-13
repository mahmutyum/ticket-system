import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  JOB_REGISTRY,
  jobDefinition,
  nextRuns,
  syncSchedule,
  validateCron,
} from '../../jobs/scheduler.js';
import { commonErrorResponses, successResponseSchema } from '../../utils/api-schema.js';
import { paginationMetaSchema, pageParamsSchema, paginate, paginatedResponse } from '../../utils/pagination.js';
import { createAuditLog } from '../../middleware/audit.js';
import { t } from '../../i18n/index.js';

/**
 * Zamanlanmış görevler yönetimi (v1.2) — yalnızca `admin`.
 *
 * Görevin VARLIĞI kodda (JOB_REGISTRY) tanımlıdır; panel yalnızca cron /
 * saat dilimi / aktiflik durumunu değiştirir. Retention APPLY bilinçli olarak
 * görev listesinde yoktur — yıkıcı işlem otomatik çalıştırılamaz.
 */

const idParams = z.object({ key: z.string().min(1).max(64) });

const jobViewSchema = z.object({
  key: z.string(),
  cron: z.string(),
  timezone: z.string(),
  enabled: z.boolean(),
  description: z.object({ tr: z.string(), en: z.string() }),
  queue: z.string(),
  nextRuns: z.array(z.date()),
  lastRun: z
    .object({
      startedAt: z.date(),
      finishedAt: z.date().nullable(),
      status: z.string(),
      summary: z.string().nullable(),
      error: z.string().nullable(),
    })
    .nullable(),
});

const updateBody = z.object({
  cron: z.string().trim().max(120).optional(),
  timezone: z.string().trim().max(64).optional(),
  enabled: z.boolean().optional(),
});

export const scheduledJobsRoutes: FastifyPluginAsyncZod = async (app) => {
  const admin = [app.requireRole('admin')];

  /** Registry + DB tercihleri + son çalışma — panelin liste görünümü. */
  app.get('/', {
    preValidation: admin,
    schema: {
      tags: ['Scheduled Jobs'],
      summary: 'Zamanlanmış görevleri kayıt defteriyle listeler',
      response: {
        200: z.object({ success: z.literal(true), data: z.array(jobViewSchema) }),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    const rows = await app.prisma.scheduledJob.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const lastRuns = await app.prisma.scheduledJobRun.findMany({
      orderBy: { startedAt: 'desc' },
      // Kayıt defteri başına son çalışma: grup başına 1 kayıt alıp birleştirmek
      // yerine son 200 çalışma içinden registry anahtarlarına indirger.
      take: 200,
    });
    const lastRunByKey = new Map<string, (typeof lastRuns)[number]>();
    for (const run of lastRuns) {
      if (!lastRunByKey.has(run.jobKey)) lastRunByKey.set(run.jobKey, run);
    }
    const data = JOB_REGISTRY.map((def) => {
      const row = byKey.get(def.key);
      const cron = row?.cron ?? def.defaultCron;
      const timezone = row?.timezone ?? def.defaultTimezone;
      const enabled = row?.enabled ?? true;
      const last = lastRunByKey.get(def.key);
      let preview: Date[] = [];
      if (enabled) {
        try {
          preview = nextRuns(cron, timezone, 5);
        } catch {
          preview = []; // geçersiz cron — syncSchedule bunu loglamıştı, görev duraklatıldı
        }
      }
      return {
        key: def.key,
        cron,
        timezone,
        enabled,
        description: def.description,
        queue: def.jobName,
        nextRuns: preview,
        lastRun: last
          ? {
              startedAt: last.startedAt,
              finishedAt: last.finishedAt,
              status: last.status,
              summary: last.summary,
              error: last.error,
            }
          : null,
      };
    });
    reply.send({ success: true, data });
  });

  /** Cron / saat dilimi / aktiflik güncelleme — kayıt DB'de saklanır ve uygulanır. */
  app.put('/:key', {
    preValidation: admin,
    schema: {
      tags: ['Scheduled Jobs'],
      summary: 'Görevin cron / saat dilimi / aktiflik ayarını günceller',
      params: idParams,
      body: updateBody,
      response: { 200: successResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const def = jobDefinition(request.params.key);
    if (!def) return reply.status(404).send({ success: false, error: t(request, 'scheduled_jobs.not_found') });
    const body = request.body;

    const existing = await app.prisma.scheduledJob.findUnique({ where: { key: def.key } });
    const cron = body.cron ?? existing?.cron ?? def.defaultCron;
    const timezone = body.timezone ?? existing?.timezone ?? def.defaultTimezone;
    const enabled = body.enabled ?? existing?.enabled ?? true;

    try {
      validateCron(cron, timezone);
    } catch {
      return reply.status(400).send({ success: false, error: t(request, 'scheduled_jobs.invalid_cron') });
    }

    await app.prisma.scheduledJob.upsert({
      where: { key: def.key },
      update: { cron, timezone, enabled },
      create: { key: def.key, cron, timezone, enabled },
    });
    await syncSchedule(app.prisma, def);
    await createAuditLog({
      entityType: 'scheduled_job',
      entityId: def.key,
      action: 'update',
      changes: { cron, timezone, enabled, previous: { cron: existing?.cron, enabled: existing?.enabled } },
      performedBy: request.staffUser!.email,
      ipAddress: request.ip,
    });
    reply.send({ success: true });
  });

  /** Çalışma geçmişi — sayfalı. */
  app.get('/:key/runs', {
    preValidation: admin,
    schema: {
      tags: ['Scheduled Jobs'],
      summary: 'Görevin çalışma geçmişini sayfalı döner',
      params: idParams,
      querystring: pageParamsSchema,
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.array(z.object({
            id: z.string(),
            startedAt: z.date(),
            finishedAt: z.date().nullable(),
            durationMs: z.number().int().nullable(),
            status: z.string(),
            summary: z.string().nullable(),
            error: z.string().nullable(),
          })),
          pagination: paginationMetaSchema,
        }),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    if (!jobDefinition(request.params.key)) {
      return reply.status(404).send({ success: false, error: t(request, 'scheduled_jobs.not_found') });
    }
    const where = { jobKey: request.params.key };
    const [runs, total] = await Promise.all([
      app.prisma.scheduledJobRun.findMany({ where, orderBy: { startedAt: 'desc' }, ...paginate(request.query) }),
      app.prisma.scheduledJobRun.count({ where }),
    ]);
    reply.send(paginatedResponse(runs, total, request.query));
  });

  /** Elle tetikleme — görev enabled=false olsa bile tek seferlik çalışır. */
  app.post('/:key/trigger', {
    preValidation: admin,
    schema: {
      tags: ['Scheduled Jobs'],
      summary: 'Görevi hemen elle çalıştırır (tek seferlik kuyruk işi)',
      params: idParams,
      response: { 200: successResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const def = jobDefinition(request.params.key);
    if (!def) return reply.status(404).send({ success: false, error: t(request, 'scheduled_jobs.not_found') });
    await def.queue.add(def.jobName, {}, {
      removeOnComplete: 100,
      removeOnFail: 200,
      // Elle tetiklenen iş için kilit + kayıt işçi tarafında (withJobRun / backup servisi) yapılır.
    });
    await createAuditLog({
      entityType: 'scheduled_job',
      entityId: def.key,
      action: 'trigger',
      changes: {},
      performedBy: request.staffUser!.email,
      ipAddress: request.ip,
    });
    reply.send({ success: true });
  });
};
