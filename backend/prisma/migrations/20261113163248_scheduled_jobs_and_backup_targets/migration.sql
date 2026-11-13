-- CreateEnum
CREATE TYPE "ScheduledRunStatus" AS ENUM ('running', 'ok', 'failed');

-- CreateEnum
CREATE TYPE "BackupTargetType" AS ENUM ('local', 's3', 'gdrive', 'ftp', 'sftp', 'webdav', 'smb');

-- CreateTable
CREATE TABLE "scheduled_jobs" (
    "key" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_jobs_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "scheduled_job_runs" (
    "id" TEXT NOT NULL,
    "job_key" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "status" "ScheduledRunStatus" NOT NULL,
    "summary" TEXT,
    "error" TEXT,

    CONSTRAINT "scheduled_job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_targets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "BackupTargetType" NOT NULL,
    "config_enc" TEXT NOT NULL,
    "retention_daily" INTEGER NOT NULL DEFAULT 7,
    "retention_weekly" INTEGER NOT NULL DEFAULT 4,
    "retention_monthly" INTEGER NOT NULL DEFAULT 6,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_result" JSONB,
    "last_success_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_job_runs_job_key_started_at_idx" ON "scheduled_job_runs"("job_key", "started_at");

-- AddForeignKey
ALTER TABLE "scheduled_job_runs" ADD CONSTRAINT "scheduled_job_runs_job_key_fkey" FOREIGN KEY ("job_key") REFERENCES "scheduled_jobs"("key") ON DELETE CASCADE ON UPDATE CASCADE;
