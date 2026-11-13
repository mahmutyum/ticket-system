import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Merkezi zamanlanmış görev altyapısı (v1.2): cron doğrulama, DB → BullMQ
 * senkronizasyonu, tekil çalışma kilidi + çalışma kaydı (`withJobRun`) ve
 * başarısızlık bildirimi.
 */

const scheduledJobMock = {
  findUnique: vi.fn(),
  create: vi.fn(),
  upsert: vi.fn(),
};
const scheduledJobRunMock = { create: vi.fn(), update: vi.fn() };
const staffMock = { findMany: vi.fn() };
const prismaMock = {
  scheduledJob: scheduledJobMock,
  scheduledJobRun: scheduledJobRunMock,
  staff: staffMock,
};

const upsertJobScheduler = vi.fn().mockResolvedValue(undefined);
const removeJobScheduler = vi.fn().mockResolvedValue(undefined);
const queueMock = { upsertJobScheduler, removeJobScheduler };

const redisSet = vi.fn();
const redisEval = vi.fn().mockResolvedValue(1);

vi.mock('../../src/db.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/jobs/queue.js', () => ({
  redisConnection: { set: (...a: unknown[]) => redisSet(...a), eval: (...a: unknown[]) => redisEval(...a) },
  backupQueue: queueMock,
  mailFetchQueue: queueMock,
  slaCheckQueue: queueMock,
  queueEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/config/index.js', () => ({
  config: { BACKUP_TZ: 'Europe/Istanbul', BACKUP_CRON: '0 3 * * *', BACKUP_VERIFY_CRON: '0 5 * * 0' },
}));

beforeEach(() => {
  vi.clearAllMocks();
  redisSet.mockReset().mockResolvedValue('OK');
  redisEval.mockReset().mockResolvedValue(1);
  upsertJobScheduler.mockReset().mockResolvedValue(undefined);
  removeJobScheduler.mockReset().mockResolvedValue(undefined);
});

async function subject() {
  return import('../../src/jobs/scheduler.js');
}

describe('validateCron / nextRuns', () => {
  it('geçerli cron kabul edilir', async () => {
    const { validateCron } = await subject();
    expect(() => validateCron('*/5 * * * *')).not.toThrow();
    expect(() => validateCron('0 3 * * *', 'Europe/Istanbul')).not.toThrow();
  });

  it('geçersiz cron hata fırlatır', async () => {
    const { validateCron } = await subject();
    expect(() => validateCron('not a cron')).toThrow();
    expect(() => validateCron('61 * * * *')).toThrow();
  });

  it('nextRuns sıralı ve istenen sayıda zaman döner', async () => {
    const { nextRuns } = await subject();
    const runs = nextRuns('*/5 * * * *', 'UTC', 5);
    expect(runs).toHaveLength(5);
    expect(runs[0].getTime()).toBeLessThan(runs[4].getTime());
  });
});

describe('syncSchedule', () => {
  it('eksik kaydı varsayılanlarla oluşturur ve scheduler\'ı kurar', async () => {
    scheduledJobMock.findUnique.mockResolvedValue(null);
    scheduledJobMock.create.mockImplementation(async ({ data }) => ({ ...data }));
    const { syncSchedule, JOB_REGISTRY } = await subject();
    await syncSchedule(prismaMock as never, { ...JOB_REGISTRY[0], queue: queueMock as never });
    expect(scheduledJobMock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ key: 'sla-check', cron: '*/5 * * * *' }),
    });
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'sla-check',
      expect.objectContaining({ pattern: '*/5 * * * *' }),
      expect.objectContaining({ name: 'sla-check' }),
    );
  });

  it('mevcut tercihi EZMEZ — panel cron\'u geçerlidir', async () => {
    scheduledJobMock.findUnique.mockResolvedValue({ key: 'sla-check', cron: '0 */6 * * *', timezone: 'UTC', enabled: true });
    const { syncSchedule, JOB_REGISTRY } = await subject();
    await syncSchedule(prismaMock as never, { ...JOB_REGISTRY[0], queue: queueMock as never });
    expect(scheduledJobMock.create).not.toHaveBeenCalled();
    expect(upsertJobScheduler).toHaveBeenCalledWith('sla-check', expect.objectContaining({ pattern: '0 */6 * * *' }), expect.anything());
  });

  it('disabled görevin scheduler\'ını SİLİNİR — iş kuyruğa hiç girmez', async () => {
    scheduledJobMock.findUnique.mockResolvedValue({ key: 'sla-check', cron: '*/5 * * * *', timezone: 'UTC', enabled: false });
    const { syncSchedule, JOB_REGISTRY } = await subject();
    await syncSchedule(prismaMock as never, { ...JOB_REGISTRY[0], queue: queueMock as never });
    expect(upsertJobScheduler).not.toHaveBeenCalled();
    expect(removeJobScheduler).toHaveBeenCalledWith('sla-check');
  });

  it('bozuk cron açılışı düşürmez: scheduler silinir ve görev duraklatılır', async () => {
    scheduledJobMock.findUnique.mockResolvedValue({ key: 'sla-check', cron: 'not-a-cron', timezone: 'UTC', enabled: true });
    const { syncSchedule, JOB_REGISTRY } = await subject();
    await expect(syncSchedule(prismaMock as never, { ...JOB_REGISTRY[0], queue: queueMock as never })).resolves.toBeUndefined();
    expect(upsertJobScheduler).not.toHaveBeenCalled();
    expect(removeJobScheduler).toHaveBeenCalledWith('sla-check');
  });

  it('registry tamamlıdır: backup + backup-verify + retention-check dahil 6 görev', async () => {
    const { JOB_REGISTRY } = await subject();
    const keys = JOB_REGISTRY.map((d) => d.key).sort();
    expect(keys).toEqual(['auto-close', 'backup', 'backup-verify', 'mail-fetch', 'retention-check', 'sla-check']);
  });

  it('retention-apply kayıt defterinde YOKTUR — yıkıcı işlem otomatik çalıştırılamaz', async () => {
    const { JOB_REGISTRY } = await subject();
    expect(JOB_REGISTRY.some((d) => d.key.includes('apply'))).toBe(false);
  });
});

describe('withJobRun', () => {
  async function run(key: string, fn: () => Promise<string | void>) {
    const { withJobRun } = await subject();
    return withJobRun(key, fn, { prismaClient: prismaMock as never });
  }

  it('kilit alınamazsa skipped döner ve fn çalışmaz (üst üste binme koruması)', async () => {
    redisSet.mockResolvedValue(null); // SET NX başarısız = kilit başkasında
    const fn = vi.fn();
    const outcome = await run('sla-check', fn);
    expect(outcome).toEqual({ skipped: true, ok: true });
    expect(fn).not.toHaveBeenCalled();
    expect(scheduledJobRunMock.create).not.toHaveBeenCalled();
  });

  it('başarılı çalışmayı ok + summary ile kapatır', async () => {
    redisSet.mockResolvedValue('OK');
    scheduledJobRunMock.create.mockResolvedValue({ id: 'run-1' });
    scheduledJobRunMock.update.mockResolvedValue({});
    const outcome = await run('sla-check', async () => 'breaches=0');
    expect(outcome).toEqual({ skipped: false, ok: true, summary: 'breaches=0' });
    expect(scheduledJobRunMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ok', summary: 'breaches=0' }) }),
    );
    expect(redisEval).toHaveBeenCalled(); // kilit bırakıldı
  });

  it('hata durumunda failed kaydı yazar, admin\'lere e-posta kuyruklar', async () => {
    redisSet.mockResolvedValue('OK');
    scheduledJobRunMock.create.mockResolvedValue({ id: 'run-2' });
    scheduledJobRunMock.update.mockResolvedValue({});
    staffMock.findMany.mockResolvedValue([{ email: 'a@x', locale: 'tr' }]);
    const { queueEmail } = await import('../../src/jobs/queue.js');
    const outcome = await run('backup', async () => { throw new Error('disk full'); });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('disk full');
    expect(scheduledJobRunMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed', error: 'disk full' }) }),
    );
    expect(queueEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@x', templateSlug: 'scheduled_job_failed' }),
    );
  });

  it('fn sessizce undefined dönerse kayıt ok olur ama summary boş kalır', async () => {
    redisSet.mockResolvedValue('OK');
    scheduledJobRunMock.create.mockResolvedValue({ id: 'run-3' });
    const outcome = await run('mail-fetch', async () => undefined);
    expect(outcome.ok).toBe(true);
    expect(outcome.summary).toBeUndefined();
  });
});
