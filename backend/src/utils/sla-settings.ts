import { z } from 'zod';
import { Priority } from '@prisma/client';
import { WEEKDAYS, isValidTimezone, parseTime, type BusinessCalendar } from './business-hours.js';

/**
 * Şirket bazlı SLA ayarları (`companies.sla_settings` JSON kolonu).
 *
 * Kolon boşsa ya da alan eksikse `DEFAULT_SLA_SETTINGS` geçerlidir: 7/24 SLA,
 * %80'de ihlal öncesi uyarı, ihlalde yöneticiye bildirim, çözülen ticket'ın 7 gün
 * sonra otomatik kapanması (bekleme hatırlatması/kapatması varsayılan kapalı).
 *
 * Okurken daima `parseSlaSettings` kullanılır: JSON kolonu elle düzenlenmiş ya da
 * eski biçimde olabilir, bozuk veri SLA işçisini düşürmemeli.
 */

const timeString = z.string().refine(v => Number.isFinite(parseTime(v)), { message: 'HH:MM' });

const timeWindowSchema = z
  .object({ start: timeString, end: timeString })
  .refine(w => parseTime(w.end) > parseTime(w.start), { message: 'end > start' });

const weekSchema = z.object(
  Object.fromEntries(WEEKDAYS.map(day => [day, z.array(timeWindowSchema).max(4).optional()])) as Record<
    (typeof WEEKDAYS)[number],
    z.ZodOptional<z.ZodArray<typeof timeWindowSchema>>
  >,
);

export const slaSettingsSchema = z.object({
  businessHours: z
    .object({
      enabled: z.boolean(),
      timezone: z.string().refine(isValidTimezone, { message: 'invalid timezone' }),
      week: weekSchema,
    })
    .nullable()
    .default(null),
  /** Bu önceliklerde takvim yok sayılır, SLA 7/24 işler. */
  alwaysOnPriorities: z.array(z.nativeEnum(Priority)).default([]),
  /** SLA süresinin yüzde kaçı dolunca uyarı gönderilir. 0 → ihlal öncesi uyarı yok. */
  warningPercent: z.number().int().min(0).max(99).default(80),
  escalation: z
    .object({
      /** İhlalde şirketin IT yöneticilerine bildirim. */
      notifyManagers: z.boolean().default(true),
      /** Çözüm SLA'sı ihlalinde önceliği bir kademe yükselt. */
      bumpPriority: z.boolean().default(false),
    })
    .default({}),
  /** Çözüm/kapanışta talep sahibine memnuniyet anketi (CSAT) gönderilsin mi. */
  satisfactionSurvey: z.boolean().default(true),
  /** Otomatik kapatma (gün). 0 → kapalı. */
  autoClose: z
    .object({
      /** `resolved` durumunda bu kadar gün yeniden açılmayan ticket kapatılır. */
      resolvedAfterDays: z.number().int().min(0).max(365).default(7),
      /** `waiting_user_response`ta bu kadar gün yanıt gelmezse talep sahibine hatırlatma. */
      waitingReminderAfterDays: z.number().int().min(0).max(365).default(0),
      /** `waiting_user_response`ta bu kadar gün yanıt gelmezse ticket kapatılır. */
      waitingCloseAfterDays: z.number().int().min(0).max(365).default(0),
    })
    .default({})
    .refine(
      a => a.waitingCloseAfterDays === 0 || a.waitingReminderAfterDays === 0 || a.waitingReminderAfterDays < a.waitingCloseAfterDays,
      { message: 'reminder < close', path: ['waitingReminderAfterDays'] },
    ),
});

export type SlaSettings = z.infer<typeof slaSettingsSchema>;

export const DEFAULT_SLA_SETTINGS: SlaSettings = slaSettingsSchema.parse({});

export const DEFAULT_WEEK = {
  mon: [{ start: '09:00', end: '18:00' }],
  tue: [{ start: '09:00', end: '18:00' }],
  wed: [{ start: '09:00', end: '18:00' }],
  thu: [{ start: '09:00', end: '18:00' }],
  fri: [{ start: '09:00', end: '18:00' }],
};

/** Bozuk/eksik JSON'u güvenle varsayılanlara indirger (asla fırlatmaz). */
export function parseSlaSettings(raw: unknown): SlaSettings {
  const parsed = slaSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_SLA_SETTINGS;
}

/**
 * Bir ticket için geçerli iş takvimi. `null` → SLA 7/24 (duvar saati) işler.
 * `holidays` yerel "YYYY-MM-DD" listesidir (şirket tatil tablosundan).
 */
export function resolveCalendar(
  settings: SlaSettings,
  holidays: string[],
  priority: Priority,
): BusinessCalendar | null {
  const bh = settings.businessHours;
  if (!bh?.enabled) return null;
  if (settings.alwaysOnPriorities.includes(priority)) return null;
  return { timezone: bh.timezone, week: bh.week, holidays };
}
