#!/usr/bin/env node
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import pg from 'pg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, stat, writeFile, rm, mkdir } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { decryptPayload, parseTargetConfig, extractHostsFromIni, selectGfsKeep, checkDumpSanity, requiredFreeBytes } from './lib.mjs';

/**
 * Yedekleme servisi işçisi (v1.2) — `backup` compose profilinde ayrı konteynerde
 * çalışır; backend imajı pg_dump/rclone/age araçlarıyla ŞİŞİRİLMEZ. Tetikleme
 * backend zamanlayıcısından `backup` kuyruğu üzerinden gelir; sonuçlar
 * `scheduled_job_runs` tablosuna burada yazılır.
 *
 * Format `scripts/backup.sh` ile birebirdir (restore uyumluluğu):
 *   <stamp>/database.dump  — pg_dump özel format
 *   <stamp>/uploads.tar.gz — uploads volume arşivi
 *   <stamp>/environment.snapshot — .env kopyası (chmod 600)
 *   <stamp>/SHA256SUMS     — bütünlük manifesti
 *
 * Uzak hedeflere yüklemeden ÖNCE arşiv şifrelenir: BACKUP_ENCRYPTION_RECIPIENT
 * (age açık anahtarı) tanımlıysa `age` ile, uzak hedef varsa ZORUNLU. Çözüm
 * özel anahtarı sistemde tutulmaz — operatördedir.
 */

const run = promisify(execFile);
const { Pool } = pg;

const required = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Gerekli ortam değişkeni eksik: ${name}`);
  return v;
};

const DATABASE_URL = required('DATABASE_URL');
const REDIS_URL = required('REDIS_URL');
const ENC_KEY = required('CREDENTIALS_ENC_KEY');
const UPLOADS_DIR = process.env.BACKUP_UPLOADS_DIR ?? '/src/uploads';
const ENV_FILE = process.env.BACKUP_ENV_FILE ?? '/src/.env';
const LOCAL_BACKUP_DIR = process.env.BACKUP_DIR ?? '/backups';
const BACKUP_PREFIX = 'backups';
const AGE_RECIPIENT = process.env.BACKUP_ENCRYPTION_RECIPIENT || '';
const STAMP = () => new Date().toISOString().replace(/[-:.]/g, '').replace('T', 'T').slice(0, 15) + 'Z';
// Tarih damgası: 20261113T031500Z biçimi — backup.sh ile aynı kural.

const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

// ==================== ÇALIŞMA KAYDI ====================
// withJobRun'in backend'deki karşılığı; burada DB erişimi düz SQL'dir.

async function recordRun(jobKey, fn) {
  const startedAt = Date.now();
  // `id` Prisma'da @default(cuid()) ile İSTEMCİ tarafında üretilir — DB
  // default'u yoktur. Düz SQL insert yapan bu işçi kimliği kendisi üretir.
  const runId = crypto.randomUUID();
  await pool.query(
    'INSERT INTO scheduled_job_runs (id, job_key, status) VALUES ($1, $2, $3)',
    [runId, jobKey, 'running'],
  );
  try {
    const summary = await fn();
    await pool.query(
      'UPDATE scheduled_job_runs SET finished_at = now(), duration_ms = $1, status = $2, summary = $3 WHERE id = $4',
      [Date.now() - startedAt, 'ok', summary ?? null, runId],
    );
    return { ok: true, summary };
  } catch (err) {
    const message = String(err?.message ?? err).slice(0, 2000);
    await pool.query(
      'UPDATE scheduled_job_runs SET finished_at = now(), duration_ms = $1, status = $2, error = $3 WHERE id = $4',
      [Date.now() - startedAt, 'failed', message, runId],
    );
    await notifyFailure(jobKey, message);
    return { ok: false, error: message };
  }
}

/** Başarısızlık bildirimi: admin'lere backend'in e-posta işçisi üzerinden şablonlu mail. */
async function notifyFailure(jobKey, message) {
  try {
    const { rows: admins } = await pool.query(
      "SELECT email, locale FROM staff WHERE role = 'admin' AND is_active = true",
    );
    if (admins.length === 0) return;
    const { Queue } = await import('bullmq');
    const bull = new Queue('email', { connection: new IORedis(REDIS_URL, { maxRetriesPerRequest: null }) });
    for (const admin of admins) {
      await bull.add(
        'send-email',
        {
          to: admin.email,
          templateSlug: 'scheduled_job_failed',
          variables: { jobKey, errorMessage: message.slice(0, 500) },
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 100, removeOnFail: 200 },
      );
    }
    await bull.close();
  } catch (err) {
    console.error('[Backup] hata bildirimi kuyruğa yazılamadı', err?.message ?? err);
  }
}

// ==================== YARDIMCILAR ====================

async function dirSizeBytes(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const s = await stat(full);
    total += entry.isDirectory() ? await dirSizeBytes(full) : s.size;
  }
  return total;
}

async function diskFreeBytes(dir) {
  const tmp = await mkdtemp(path.join(dir, 'probe-'));
  try {
    // promisify(execFile) { stdout, stderr } NESNESİ döner — stdout'tan oku.
    const { stdout } = await run('df', ['-k', '-P', tmp]);
    const cols = stdout.trim().split('\n').at(-1).split(/\s+/);
    return Number(cols.at(-2)) * 1024;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function sha256sum(targetDir, files) {
  const lines = [];
  for (const file of files) {
    const hash = crypto.createHash('sha256');
    await pipeline(createReadStream(path.join(targetDir, file)), hash);
    lines.push(`${hash.digest('hex')}  ${file}`);
  }
  const manifest = lines.join('\n') + '\n';
  await writeFile(path.join(targetDir, 'SHA256SUMS'), manifest, { mode: 0o600 });
}

/** rclone'u hedefin INI yapılandırmasıyla çalıştırır; geçici config temizlenir. */
async function withRclone(configEnc, fn) {
  const { ini } = parseTargetConfig(configEnc, ENC_KEY);
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'rclone-'));
  const conf = path.join(tmp, 'rclone.conf');
  await writeFile(conf, ini, { mode: 0o600 });
  try {
    return await fn(conf);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** SSRF denetimi: hedef INI'sindeki endpoint host'ları net-guard kurallarıyla aynı mantıkla engellenir. */
function assertTargetHostsAllowed(ini) {
  const hosts = extractHostsFromIni(ini);
  const allowPrivate = process.env.ALLOW_PRIVATE_INTEGRATION_HOSTS === 'true';
  for (const host of hosts) {
    const name = host.toLowerCase();
    const isPrivate =
      name === 'localhost' || name.endsWith('.local') ||
      /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(name) ||
      name === '169.254.169.254' || name === 'metadata.google.internal';
    if (isPrivate && !allowPrivate) {
      throw new Error(`Hedef iç ağ adresine işaret ediyor (${host}) — ALLOW_PRIVATE_INTEGRATION_HOSTS gerektirir`);
    }
    if (name === '169.254.169.254' || name === 'metadata.google.internal') {
      throw new Error(`Bulut metadata adresi her koşulda engellidir: ${host}`);
    }
  }
}

async function enabledTargets() {
  const { rows } = await pool.query(
    'SELECT id, name, type, config_enc, retention_daily, retention_weekly, retention_monthly FROM backup_targets WHERE enabled = true ORDER BY created_at',
  );
  return rows;
}

/** Uzak hedefler varsa şifreleme ZORUNLUDUR (environment.snapshot sır içerir). */
async function assertEncryptionPolicy(targets, encrypted) {
  const hasRemote = targets.some((t) => t.type !== 'local');
  if (hasRemote && !encrypted) {
    throw new Error('Uzak hedefe şifresiz yükleme reddedildi: BACKUP_ENCRYPTION_RECIPIENT (age açık anahtarı) zorunludur');
  }
}

// ==================== YEDEKLEME HATTI ====================

async function runBackup() {
  const targets = await enabledTargets();
  const stamp = STAMP();
  const targetDir = path.join(LOCAL_BACKUP_DIR, stamp);
  await mkdir(targetDir, { recursive: true, mode: 0o700 });

  // 1) Disk alanı: mevcut en büyük arşivin 2 katı + tampon.
  let largest = 0;
  try {
    for (const entry of await readdir(LOCAL_BACKUP_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      largest = Math.max(largest, await dirSizeBytes(path.join(LOCAL_BACKUP_DIR, entry.name)));
    }
  } catch { /* ilk çalışmada dizin boş olabilir */ }
  const free = await diskFreeBytes(LOCAL_BACKUP_DIR);
  if (free < requiredFreeBytes(largest)) {
    throw new Error(`Yetersiz disk alanı: ${free} byte boş, en az ${requiredFreeBytes(largest)} gerekli`);
  }

  // 2) Veritabanı dump'u (özel format) — restore.sh ile aynı araç.
  const dumpPath = path.join(targetDir, 'database.dump');
  await run('pg_dump', [DATABASE_URL, '-Fc', '-f', dumpPath]);
  const dumpSanity = checkDumpSanity((await stat(dumpPath)).size);
  if (dumpSanity) throw new Error(`Bozuk/şüpheli dump: ${dumpSanity}`);

  // 3) Uploads arşivi.
  const uploadsPath = path.join(targetDir, 'uploads.tar.gz');
  await run('tar', ['-czf', uploadsPath, '-C', UPLOADS_DIR, '.']);

  // 4) Ortam anlık görüntüsü (sır içerir — 600).
  await run('cp', [ENV_FILE, path.join(targetDir, 'environment.snapshot')]);
  await run('chmod', ['600', path.join(targetDir, 'environment.snapshot')]);

  // 5) Manifest.
  await sha256sum(targetDir, ['database.dump', 'uploads.tar.gz', 'environment.snapshot']);

  // 6) Uzak hedeflere şifreleyerek yükle.
  await assertEncryptionPolicy(targets, Boolean(AGE_RECIPIENT));
  const perTarget = [];
  for (const target of targets) {
    const result = { id: target.id, name: target.name, type: target.type, ok: false };
    try {
      await withRclone(target.config_enc, async (conf) => {
        const work = targetDir;
        let uploadDir = work;
        if (AGE_RECIPIENT) {
          // Arşiv yüklenmeden ÖNCE şifrelenir — uzak kopyada açık veri hiç bulunmaz.
          uploadDir = path.join(os.tmpdir(), `backup-enc-${stamp}`);
          await mkdir(uploadDir, { recursive: true });
          for (const file of await readdir(work)) {
            await run('age', ['-r', AGE_RECIPIENT, '-o', path.join(uploadDir, `${file}.age`), path.join(work, file)]);
          }
        }
        const remotePath = `${BACKUP_PREFIX}/${stamp}/`;
        await run('rclone', ['--config', conf, 'copy', uploadDir, `target:${remotePath}`, '--transfers', '2']);
        // Yükleme doğrulaması: uzak boyutlar yerelinkiyle eşleşmeli (age ile çarpı).
        const listing = await run('rclone', ['--config', conf, 'ls', `target:${remotePath}`]);
        const expected = (await readdir(uploadDir)).length;
        const listed = listing.stdout.trim() ? listing.stdout.trim().split('\n').length : 0;
        if (listed !== expected) throw new Error(`Yükleme doğrulaması: uzakta ${listed} dosya, beklenen ${expected}`);
      });
      result.ok = true;
      await pool.query(
        'UPDATE backup_targets SET last_result = $1, last_success_at = now() WHERE id = $2',
        [JSON.stringify({ ok: true, stamp, at: new Date().toISOString() }), target.id],
      );
    } catch (err) {
      result.error = String(err?.message ?? err).slice(0, 300);
      await pool.query(
        'UPDATE backup_targets SET last_result = $1 WHERE id = $2',
        [JSON.stringify({ ok: false, stamp, error: result.error, at: new Date().toISOString() }), target.id],
      );
    }
    perTarget.push(result);
  }

  // 7) Hedef bazlı GFS budama — yerel dizin için de uygulanır (varsayılanlar env'den).
  const prune = await pruneLocal();
  const failed = perTarget.filter((t) => !t.ok);
  const summary =
    `stamp=${stamp} targets=${perTarget.length} ok=${perTarget.length - failed.length} ` +
    `prunedLocal=${prune.deleted}` + (failed.length ? ` failed=[${failed.map((f) => f.name).join(',')}]` : '');
  if (failed.length > 0) throw new Error(`Bazı hedefler başarısız: ${summary}`);
  return summary;
}

/** Yerel yedek dizininde GFS budama (env varsayılanları 7/4/6). */
async function pruneLocal() {
  const retention = {
    daily: Number(process.env.BACKUP_RETENTION_DAILY ?? 7),
    weekly: Number(process.env.BACKUP_RETENTION_WEEKLY ?? 4),
    monthly: Number(process.env.BACKUP_RETENTION_MONTHLY ?? 6),
  };
  const entries = [];
  for (const entry of await readdir(LOCAL_BACKUP_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    // Damga DİZİN ADINDAN çözülür (backup.sh ile aynı biçim) — mtime kopyalama/
    // taşımada değişebileceği için rotasyon kararı güvenilir bir kaynaktır.
    const stamp = parseStamp(entry.name);
    const s = await stat(path.join(LOCAL_BACKUP_DIR, entry.name));
    entries.push({ key: entry.name, stamp: Number.isFinite(stamp.getTime()) ? stamp : new Date(s.mtime) });
  }
  const keep = selectGfsKeep(entries, retention);
  let deleted = 0;
  for (const entry of entries) {
    if (!keep.has(entry.key)) {
      await rm(path.join(LOCAL_BACKUP_DIR, entry.key), { recursive: true, force: true });
      deleted += 1;
    }
  }
  return { deleted };
}

/** Uzak hedef bazlı GFS budama. */
async function pruneRemote(target) {
  const retention = {
    daily: target.retention_daily,
    weekly: target.retention_weekly,
    monthly: target.retention_monthly,
  };
  return withRclone(target.config_enc, async (conf) => {
    const listing = await run('rclone', ['--config', conf, 'lsf', `target:${BACKUP_PREFIX}/`, '--dirs-only']);
    const entries = listing.stdout
      .split('\n')
      .filter((line) => line.trim().endsWith('/'))
      .map((line) => ({ key: line.trim().replace(/\/$/, ''), stamp: parseStamp(line.trim().replace(/\/$/, '')) }))
      .filter((entry) => Number.isFinite(entry.stamp.getTime()));
    const keep = selectGfsKeep(entries, retention);
    let deleted = 0;
    for (const entry of entries) {
      if (!keep.has(entry.key)) {
        await run('rclone', ['--config', conf, 'purge', `target:${BACKUP_PREFIX}/${entry.key}`]);
        deleted += 1;
      }
    }
    return deleted;
  });
}

/** 20261113T031500Z biçimini Date'e çözer; uymazsa NaT döner (filtrelenir). */
function parseStamp(name) {
  const m = name.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return new Date(NaN);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

// ==================== RESTORE PROVASI ====================

async function runVerify() {
  const drillDb = `restore_drill_${Date.now()}`;
  // En yeni yerel dump: stamp sırasına göre ilk dizin.
  const entries = (await readdir(LOCAL_BACKUP_DIR, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && Number.isFinite(parseStamp(e.name).getTime()))
    .sort((a, b) => b.name.localeCompare(a.name));
  if (entries.length === 0) throw new Error('Restore provası için yerel yedek bulunamadı');
  const dumpPath = path.join(LOCAL_BACKUP_DIR, entries[0].name, 'database.dump');

  const url = new URL(DATABASE_URL);
  const adminUrl = `postgresql://${encodeURIComponent(url.username)}:${decodeURIComponent(url.password)}@${url.host}/postgres`;

  try {
    await run('psql', [adminUrl, '-c', `CREATE DATABASE "${drillDb}"`]);
    // pg_restore'a da TAM bağlantı adresi verilir — yalnızca db adı lokal
    // unix socket'e bağlanmaya çalışır (konteynerde socket yoktur).
    const drillUrl = `postgresql://${encodeURIComponent(url.username)}:${decodeURIComponent(url.password)}@${url.host}/${drillDb}`;
    await run('pg_restore', ['-d', drillUrl, '--no-owner', '--no-privileges', dumpPath]);

    const { rows: tables } = await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const { rows: migration } = await pool.query(
      'SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1',
    );
    const summary = `drillDb=${drillDb} tables=${tables[0].n} latestMigration=${migration[0]?.migration_name ?? '?'}`;
    await run('psql', [adminUrl, '-c', `DROP DATABASE "${drillDb}"`]);
    return summary;
  } catch (err) {
    // Kalıntı drill veritabanını temizle.
    try {
      await run('psql', [adminUrl, '-c', `DROP DATABASE IF EXISTS "${drillDb}"`]);
    } catch { /* temizlik hatası orijinal hatayı gölgelemesin */ }
    throw err;
  }
}

// ==================== BAĞLANTI TESTİ ====================

/** Test bağlantısı: küçük dosya yaz → sil (yol haritası §v1.2-3). Sonucu Redis'e yazar. */
async function runTestTarget(targetId) {
  const { rows } = await pool.query('SELECT id, config_enc FROM backup_targets WHERE id = $1', [targetId]);
  if (rows.length === 0) throw new Error('Hedef bulunamadı');
  const result = { ok: false, at: new Date().toISOString() };
  try {
    const { ini } = parseTargetConfig(rows[0].config_enc, ENC_KEY);
    assertTargetHostsAllowed(ini);
    await withRclone(rows[0].config_enc, async (conf) => {
      const probe = `probe-${Date.now()}.txt`;
      const localProbe = path.join(os.tmpdir(), probe);
      await writeFile(localProbe, 'ticket-system backup target test\n');
      await run('rclone', ['--config', conf, 'copyto', localProbe, `target:${BACKUP_PREFIX}/.probe/${probe}`]);
      await run('rclone', ['--config', conf, 'delete', `target:${BACKUP_PREFIX}/.probe/${probe}`]);
      await rm(localProbe, { force: true });
    });
    result.ok = true;
  } catch (err) {
    result.error = String(err?.message ?? err).slice(0, 300);
  }
  await redis.set(`backup-test:${targetId}`, JSON.stringify(result), 'EX', 120);
  return `target=${targetId} ok=${result.ok}`;
}

/** Hedef listesi: uzak dizin adları (panelin "yedek listesi" görüntüsü). */
async function runListBackups(targetId) {
  const { rows } = await pool.query('SELECT id, config_enc FROM backup_targets WHERE id = $1', [targetId]);
  if (rows.length === 0) throw new Error('Hedef bulunamadı');
  let listing = [];
  await withRclone(rows[0].config_enc, async (conf) => {
    const out = await run('rclone', ['--config', conf, 'lsf', `target:${BACKUP_PREFIX}/`, '--dirs-only']);
    listing = out.stdout.split('\n').filter(Boolean);
  });
  await redis.set(`backup-list:${targetId}`, JSON.stringify({ at: new Date().toISOString(), dirs: listing }), 'EX', 120);
  return `target=${targetId} dirs=${listing.length}`;
}

// ==================== WORKER ====================

const worker = new Worker(
  'backup',
  async (job) => {
    switch (job.name) {
      case 'backup':
        return recordRun('backup', runBackup);
      case 'backup-verify':
        return recordRun('backup-verify', runVerify);
      case 'test-target':
        return recordRun('backup', async () => runTestTarget(job.data.targetId));
      case 'list-backups':
        return recordRun('backup', async () => runListBackups(job.data.targetId));
      default:
        throw new Error(`Bilinmeyen backup işi: ${job.name}`);
    }
  },
  { connection: redis, concurrency: 1 },
);

worker.on('failed', (job, err) => {
  console.error(`[Backup] job ${job?.name} başarısız:`, err?.message ?? err);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    await worker.close();
    await pool.end();
    redis.disconnect();
    process.exit(0);
  });
}
