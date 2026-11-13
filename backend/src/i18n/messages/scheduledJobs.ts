export const scheduledJobsMessages = {
  tr: {
    'scheduled_jobs.not_found': 'Görev kayıt defterde bulunamadı',
    'scheduled_jobs.invalid_cron': 'Cron ifadesi geçersiz (ör. "*/5 * * * *" veya "0 3 * * *")',
  } as Record<string, string>,
  en: {
    'scheduled_jobs.not_found': 'Job not found in the registry',
    'scheduled_jobs.invalid_cron': 'Invalid cron expression (e.g. "*/5 * * * *" or "0 3 * * *")',
  } as Record<string, string>,
};

export const backupsMessages = {
  tr: {
    'backups.not_found': 'Yedek hedefi bulunamadı',
    'backups.config_required': 'Hedef yapılandırması (rclone config INI) zorunludur',
    'backups.worker_unreachable':
      'Backup servisi yanıt vermedi — `docker compose --profile backup up -d` ile çalıştırdığınızdan emin olun',
  } as Record<string, string>,
  en: {
    'backups.not_found': 'Backup target not found',
    'backups.config_required': 'Target configuration (rclone config INI) is required',
    'backups.worker_unreachable':
      'Backup service did not respond — make sure it runs via `docker compose --profile backup up -d`',
  } as Record<string, string>,
};
