import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
// cron-parser v4 CommonJS'tir — derlenmiş dist Node ESM altında NAMED import
// çalışmaz ("Named export not found"); default import + interop zorunludur.
// (Vitest'in CJS interop'u bu ayrımı gizlediği için yalnızca canlı koşuda görüldü.)
import cronParser from 'cron-parser';
import type { PrismaClient, ScheduledJob } from '@prisma/client';
import { prisma } from '../db.js';
import { config } from '../config/index.js';
import { backupQueue, mailFetchQueue, queueEmail, redisConnection, slaCheckQueue } from './queue.js';

/**
 * Merkezi zamanlanmış görev (cron) altyapısı — v1.2.
 *
 * Periyodik işler eskiden dağınıktı: SLA kontrolü ve otomatik kapatma koda
 * gömülü sabit aralıklarla (`server.ts`'teki `upsertJobScheduler` çağrıları),
 * retention kontrolü host cron'unda yarı manuel. Bu modül hepsini tek kayıt
 * defterinde toplar:
 *
 * - `JOB_REGISTRY`: her görevin anahtarı, varsayılan cron'u, saat dilimi ve
 *   hedef kuyruğu KODDA tanımlıdır — görevin varlığı koda bağlıdır, silinmesi
 *   imkânsızdır (`isSystem` mantığı).
 * - `ScheduledJob` tablosu: panelin değiştirebildiği cron / timezone / enabled
 *   değerleri. Açılışta `syncSchedules()` DB'den okuyup BullMQ scheduler'larını
 *   upsert eder; disabled görevin scheduler'ı SİLİNİR (iş kuyruğa hiç girmez).
 * - `withJobRun`: her çalışmayı Redis kiliti (üst üste binme / çoklu replika
 *   çift çalışma koruması) + `ScheduledJobRun` kaydı ile sarar; başarısızlıkta
 *   admin'lere e-posta gider.
 *
 * `backup` ve `backup-verify` görevleri BACKEND'DE ÇALIŞMAZ: kuyruk işçisi
 * ayrı `backup` servisindedir (pg_dump/rclone/age araçları backend imajını
 * şişirmesin diye). Çalışma kaydını da o servis kendi yazar.
 *
 * Retention **apply** bilinçli olarak registry'de YOKTUR — yıkıcı işlem insan
 * onayı olmadan otomatik çalıştırılamaz (bkz. docs/yol-haritasi.md).
 */

export interface JobDefinition {
  key: string;
  jobName: string;
  queue: Queue;
  defaultCron: string;
  defaultTimezone: string;
  /** Panel gösterimi için açıklama (çift dil). */
  description: { tr: string; en: string };
}

export const JOB_REGISTRY: JobDefinition[] = [
  {
    key: 'sla-check',
    jobName: 'sla-check',
    queue: slaCheckQueue,
    defaultCron: '*/5 * * * *',
    defaultTimezone: 'UTC',
    description: { tr: 'SLA uyarı / ihlal / eskalasyon taraması', en: 'SLA warning / breach / escalation scan' },
  },
  {
    key: 'auto-close',
    jobName: 'auto-close',
    queue: slaCheckQueue,
    defaultCron: '*/15 * * * *',
    defaultTimezone: 'UTC',
    description: { tr: 'Çözülen talepleri otomatik kapatır, yanıt bekleyenlere hatırlatır', en: 'Auto-closes resolved tickets, reminds awaiting ones' },
  },
  {
    key: 'mail-fetch',
    jobName: 'mail-fetch',
    queue: mailFetchQueue,
    defaultCron: '*/2 * * * *',
    defaultTimezone: 'UTC',
    description: { tr: 'Tanımlı şirket posta kutularından gelen e-postaları çeker', en: 'Fetches inbound mail from configured company mailboxes' },
  },
  {
    key: 'retention-check',
    jobName: 'retention-check',
    queue: slaCheckQueue,
    defaultCron: '15 3 * * *',
    defaultTimezone: 'UTC',
    description: { tr: 'Veri saklama politikası kontrol raporu (uygulama yalnızca elle)', en: 'Data retention check report (apply is manual only)' },
  },
  {
    key: 'backup',
    jobName: 'backup',
    queue: backupQueue,
    defaultCron: config.BACKUP_CRON,
    defaultTimezone: config.BACKUP_TZ,
    description: { tr: 'Tam yedek alır ve tanımlı hedeflere yükler', en: 'Takes a full backup and uploads it to configured targets' },
  },
  {
    key: 'backup-verify',
    jobName: 'backup-verify',
    queue: backupQueue,
    defaultCron: config.BACKUP_VERIFY_CRON,
    defaultTimezone: config.BACKUP_TZ,
    description: { tr: 'Son yedeği geçici veritabanında restore provasından geçirir', en: 'Restores the latest backup into a temporary database (drill)' },
  },
];

export function jobDefinition(key: string): JobDefinition | undefined {
  return JOB_REGISTRY.find((d) => d.key === key);
}

/** Cron ifadesini doğrular; geçersizse hata fırlatır (panel girdisi için). */
export function validateCron(expression: string, timezone = 'UTC'): void {
  cronParser.parseExpression(expression, { tz: timezone });
}

/** Cron'un bir sonraki N çalışma zamanını önizler (panel "sonraki 5 çalışma"). */
export function nextRuns(expression: string, timezone: string, count = 5): Date[] {
  const interval = cronParser.parseExpression(expression, { tz: timezone });
  const out: Date[] = [];
  for (let i = 0; i < count; i += 1) out.push(interval.next().toDate());
  return out;
}

/**
 * DB'deki ScheduledJob değerlerini BullMQ scheduler'larına uygular.
 * Açılışta `server.ts` çağırır; panel güncellemesi de aynı fonksiyonu
 * tek görev için çağırabilir. Eksik kayıt varsayılanlarla OLUŞTURULUR ama
 * mevcut cron/enabled ASLA üzerine yazılmaz (panelin tercihi sayılır).
 */
export async function syncSchedule(prismaClient: PrismaClient, def: JobDefinition): Promise<void> {
  let row: ScheduledJob | null = await prismaClient.scheduledJob.findUnique({ where: { key: def.key } });
  if (!row) {
    row = await prismaClient.scheduledJob.create({
      data: { key: def.key, cron: def.defaultCron, timezone: def.defaultTimezone, enabled: true },
    });
  }
  if (!row.enabled) {
    await def.queue.removeJobScheduler(def.key);
    return;
  }
  try {
    validateCron(row.cron, row.timezone);
  } catch {
    // Bozuk cron tüm açılışı düşürmesin: eski scheduler silinir ve yüksek sesle
    // uyarılır — panelde görev "geçersiz cron" olarak görünür, düzeltilene dek koşmaz.
    await def.queue.removeJobScheduler(def.key);
    console.error(`[Scheduler] ${def.key}: geçersiz cron "${row.cron}" — görev duraklatıldı`);
    return;
  }
  await def.queue.upsertJobScheduler(def.key, { pattern: row.cron, tz: row.timezone }, { name: def.jobName });
}

export async function syncSchedules(prismaClient: PrismaClient = prisma): Promise<void> {
  for (const def of JOB_REGISTRY) {
    await syncSchedule(prismaClient, def);
  }
}

const LOCK_PREFIX = 'job-lock:';
const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

export interface JobRunOutcome {
  /** Başka bir çalışma kilitli olduğu için atlandıysa true (normal durum, hata değil). */
  skipped: boolean;
  ok: boolean;
  summary?: string;
  error?: string;
}

/**
 * Görev çalışmasını kilit + kayıt ile sarar — backend tarafındaki tüm periyodik
 * işleyiciler bunu kullanır.
 *
 * - Redis `SET NX EX` tekil çalışma kilidi: üst üste binen çalışmayı ve çoklu
 *   replikada çift çalışmayı engeller. Kilit süresi görev başına verilir;
 *   varsayılan 4 dakikadır (en sık görev 5 dk'da bir koşar).
 * - `ScheduledJobRun` kaydı `running` olarak açılır, sonuçla kapatılır.
 * - Başarısızlıkta admin'lere `scheduled_job_failed` şablonuyla e-posta gider.
 *   (Webhook yayını ticket merkezli olduğundan bu sürümde e-posta ile sınırlıdır;
 *   ticket'sız webhook olayı ayrı bir tasarıma bırakılmıştır.)
 *
 * `fn` bir özet metni döndürebilir ("closed=1 reminded=0" gibi) — `summary`'ye yazılır.
 */
export async function withJobRun(
  jobKey: string,
  fn: () => Promise<string | void>,
  opts: { lockTtlSeconds?: number; prismaClient?: PrismaClient } = {},
): Promise<JobRunOutcome> {
  const db = opts.prismaClient ?? prisma;
  const lockKey = `${LOCK_PREFIX}${jobKey}`;
  const lockTtl = opts.lockTtlSeconds ?? 240;
  const token = randomUUID();
  const acquired = await redisConnection.set(lockKey, token, 'EX', lockTtl, 'NX');
  if (!acquired) return { skipped: true, ok: true };

  const run = await db.scheduledJobRun.create({ data: { jobKey, status: 'running' } });
  const startedAt = Date.now();
  try {
    const summary = (await fn()) || undefined;
    await db.scheduledJobRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), durationMs: Date.now() - startedAt, status: 'ok', summary: summary ?? null },
    });
    return { skipped: false, ok: true, summary };
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
    await db.scheduledJobRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), durationMs: Date.now() - startedAt, status: 'failed', error: message },
    });
    await notifyJobFailure(db, jobKey, message);
    return { skipped: false, ok: false, error: message };
  } finally {
    // Kilidi yalnızca KENDİ token'ımızla bırak: süresi dolup başka replikanın
    // kilidi alındıysa onunkini silmemeliyiz.
    await redisConnection.eval(RELEASE_LOCK_LUA, 1, lockKey, token);
  }
}

/** Başarısız görev çalışmasını tüm admin'lere bildirir. Asla fırlatmaz. */
export async function notifyJobFailure(db: PrismaClient, jobKey: string, message: string): Promise<void> {
  try {
    const admins = await db.staff.findMany({
      where: { role: 'admin', isActive: true },
      select: { email: true, locale: true },
    });
    for (const admin of admins) {
      await queueEmail({
        to: admin.email,
        templateSlug: 'scheduled_job_failed',
        variables: { jobKey, errorMessage: message },
      });
    }
  } catch (err) {
    console.error(`[Scheduler] ${jobKey}: hata bildirimi gönderilemedi`, err);
  }
}
