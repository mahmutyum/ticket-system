import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { backupQueue, redisConnection } from '../../jobs/queue.js';
import { createAuditLog } from '../../middleware/audit.js';
import { commonErrorResponses, successResponseSchema } from '../../utils/api-schema.js';
import { encrypt } from '../../utils/crypto.js';
import { assertIntegrationHost } from '../../utils/net-guard.js';
import { config } from '../../config/index.js';
import { t } from '../../i18n/index.js';

/**
 * Yedek hedefleri yönetimi (v1.2) — yalnızca `admin`.
 *
 * `configEnc`: hedefe özgü rclone config INI metni (remote adı `target` olmak
 * zorunda), AES-256-GCM şifreli saklanır ve API'den ASLA geri döndürülmez
 * (write-only). Bağlantı testi ve uzak yedek listesi rclone gerektirdiği için
 * `backup` servis işçisine kuyruklanır; sonuç Redis'e yazılır ve burada kısa
 * bir bekleme ile toplanır (yönetim paneli eşzamanlı yanıt bekler).
 */

const idParams = z.object({ id: z.string().min(1).max(128) });

const targetBody = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(['local', 's3', 'gdrive', 'ftp', 'sftp', 'webdav', 'smb']),
  /** rclone config INI — `target` adlı remote zorunlu. Write-only: yanıtta dönmez. */
  configIni: z.string().trim().min(10).max(20_000).optional(),
  retentionDaily: z.coerce.number().int().min(1).max(365).default(7),
  retentionWeekly: z.coerce.number().int().min(1).max(104).default(4),
  retentionMonthly: z.coerce.number().int().min(1).max(120).default(6),
  enabled: z.boolean().default(true),
});

const targetViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  retentionDaily: z.number().int(),
  retentionWeekly: z.number().int(),
  retentionMonthly: z.number().int(),
  enabled: z.boolean(),
  /** configIni bilinçli olarak DÖNMEZ — write-only sırdır. */
  hasConfig: z.boolean(),
  lastResult: z.unknown().nullable(),
  lastSuccessAt: z.date().nullable(),
});

/** INI'deki endpoint/url host'larını çıkarır ve SSRF denetiminden geçirir. */
async function assertTargetHostsAllowed(ini: string): Promise<void> {
  for (const match of ini.matchAll(/^\s*(?:endpoint|url|host)\s*=\s*(\S+)\s*$/gim)) {
    let hostname: string;
    try {
      hostname = new URL(match[1]).hostname;
    } catch {
      hostname = match[1];
    }
    // backend/utils/net-guard.ts ile aynı ilke: bulut metadata her koşulda,
    // iç ağ adresleri yalnızca ALLOW_PRIVATE_INTEGRATION_HOSTS ile.
    await assertIntegrationHost(hostname, config.ALLOW_PRIVATE_INTEGRATION_HOSTS);
  }
}

/** `[target]` remote adı zorunludur — worker rclone'u bu adla adresler. */
function validateTargetIni(ini: string): void {
  if (!/^\s*\[target\]\s*$/m.test(ini)) {
    throw Object.assign(new Error('rclone config [target] remote adını içermeli'), { statusCode: 400 });
  }
}

/** Backup işçisinin sonucunu Redis'ten bekler (kısa eşzamanlı bekleme). */
async function pollRedisResult<T>(key: string, timeoutMs = 20_000): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const raw = await redisConnection.get(key);
    if (raw) {
      await redisConnection.del(key);
      return JSON.parse(raw) as T;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

/** backup kuyruğunun işçisi ayrı servistedir; iş buraya yazılır, sonuç Redis'ten toplanır. */
async function enqueueBackupJob(jobName: string, data: Record<string, unknown>) {
  await backupQueue.add(jobName, data, { removeOnComplete: 100, removeOnFail: 200 });
}

export const backupsRoutes: FastifyPluginAsyncZod = async (app) => {
  const admin = [app.requireRole('admin')];

  app.get('/targets', {
    preValidation: admin,
    schema: {
      tags: ['Backups'],
      summary: 'Yedek hedeflerini listeler (config sırrı dönmez)',
      response: {
        200: z.object({ success: z.literal(true), data: z.array(targetViewSchema) }),
        ...commonErrorResponses,
      },
    },
  }, async (_request, reply) => {
    const targets = await app.prisma.backupTarget.findMany({ orderBy: { createdAt: 'asc' } });
    reply.send({
      success: true,
      data: targets.map((target) => ({
        id: target.id,
        name: target.name,
        type: target.type,
        retentionDaily: target.retentionDaily,
        retentionWeekly: target.retentionWeekly,
        retentionMonthly: target.retentionMonthly,
        enabled: target.enabled,
        hasConfig: true,
        lastResult: target.lastResult,
        lastSuccessAt: target.lastSuccessAt,
      })),
    });
  });

  app.post('/targets', {
    preValidation: admin,
    schema: {
      tags: ['Backups'],
      summary: 'Yedek hedefi oluşturur',
      body: targetBody,
      response: { 200: z.object({ success: z.literal(true), data: z.object({ id: z.string() }) }), ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const body = request.body;
    if (!body.configIni) {
      return reply.status(400).send({ success: false, error: t(request, 'backups.config_required') });
    }
    try {
      validateTargetIni(body.configIni);
      await assertTargetHostsAllowed(body.configIni);
    } catch (err) {
      return reply.status(400).send({ success: false, error: (err as Error).message });
    }
    const target = await app.prisma.backupTarget.create({
      data: {
        name: body.name,
        type: body.type,
        configEnc: encrypt(body.configIni),
        retentionDaily: body.retentionDaily,
        retentionWeekly: body.retentionWeekly,
        retentionMonthly: body.retentionMonthly,
        enabled: body.enabled,
      },
      select: { id: true },
    });
    await createAuditLog({
      entityType: 'backup_target',
      entityId: target.id,
      action: 'create',
      changes: { name: body.name, type: body.type },
      performedBy: request.staffUser!.email,
      ipAddress: request.ip,
    });
    reply.send({ success: true, data: { id: target.id } });
  });

  app.put('/targets/:id', {
    preValidation: admin,
    schema: {
      tags: ['Backups'],
      summary: 'Yedek hedefini günceller (configIni verilmezse sırrı korunur)',
      params: idParams,
      body: targetBody,
      response: { 200: successResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const existing = await app.prisma.backupTarget.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.status(404).send({ success: false, error: t(request, 'backups.not_found') });
    const body = request.body;
    let configEnc = existing.configEnc;
    if (body.configIni) {
      try {
        validateTargetIni(body.configIni);
        await assertTargetHostsAllowed(body.configIni);
      } catch (err) {
        return reply.status(400).send({ success: false, error: (err as Error).message });
      }
      configEnc = encrypt(body.configIni);
    }
    await app.prisma.backupTarget.update({
      where: { id: existing.id },
      data: {
        name: body.name,
        type: body.type,
        configEnc,
        retentionDaily: body.retentionDaily,
        retentionWeekly: body.retentionWeekly,
        retentionMonthly: body.retentionMonthly,
        enabled: body.enabled,
      },
    });
    await createAuditLog({
      entityType: 'backup_target',
      entityId: existing.id,
      action: 'update',
      changes: { name: body.name, type: body.type, configChanged: Boolean(body.configIni) },
      performedBy: request.staffUser!.email,
      ipAddress: request.ip,
    });
    reply.send({ success: true });
  });

  app.delete('/targets/:id', {
    preValidation: admin,
    schema: {
      tags: ['Backups'],
      summary: 'Yedek hedefini siler (uzak yedekler silinmez)',
      params: idParams,
      response: { 200: successResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const existing = await app.prisma.backupTarget.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.status(404).send({ success: false, error: t(request, 'backups.not_found') });
    await app.prisma.backupTarget.delete({ where: { id: existing.id } });
    await createAuditLog({
      entityType: 'backup_target',
      entityId: existing.id,
      action: 'delete',
      changes: { name: existing.name },
      performedBy: request.staffUser!.email,
      ipAddress: request.ip,
    });
    reply.send({ success: true });
  });

  /** Bağlantı testi: backup işçisi küçük dosya yazıp siler; sonuç eşzamanlı beklenir. */
  app.post('/targets/:id/test', {
    preValidation: admin,
    schema: {
      tags: ['Backups'],
      summary: 'Hedefe test bağlantısı yapar (yaz/ok/sil)',
      params: idParams,
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({ ok: z.boolean(), error: z.string().optional(), at: z.date() }),
        }),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    const existing = await app.prisma.backupTarget.findUnique({ where: { id: request.params.id }, select: { id: true } });
    if (!existing) return reply.status(404).send({ success: false, error: t(request, 'backups.not_found') });
    await enqueueBackupJob('test-target', { targetId: existing.id });
    const result = await pollRedisResult<{ ok: boolean; error?: string; at: string }>(`backup-test:${existing.id}`);
    if (!result) {
      return reply.status(400).send({ success: false, error: t(request, 'backups.worker_unreachable') });
    }
    reply.send({ success: true, data: { ok: result.ok, error: result.error, at: new Date(result.at) } });
  });

  /** Uzak yedek listesi: hedefteki stamp dizinleri. */
  app.get('/targets/:id/backups', {
    preValidation: admin,
    schema: {
      tags: ['Backups'],
      summary: 'Hedefteki yedekleri listeler',
      params: idParams,
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({ at: z.date(), dirs: z.array(z.string()) }),
        }),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    const existing = await app.prisma.backupTarget.findUnique({ where: { id: request.params.id }, select: { id: true } });
    if (!existing) return reply.status(404).send({ success: false, error: t(request, 'backups.not_found') });
    await enqueueBackupJob('list-backups', { targetId: existing.id });
    const result = await pollRedisResult<{ at: string; dirs: string[] }>(`backup-list:${existing.id}`);
    if (!result) {
      return reply.status(400).send({ success: false, error: t(request, 'backups.worker_unreachable') });
    }
    reply.send({ success: true, data: { at: new Date(result.at), dirs: result.dirs } });
  });
};
