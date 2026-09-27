import type { Priority, PrismaClient } from '@prisma/client';
import type { BusinessCalendar } from '../utils/business-hours.js';
import { parseSlaSettings, resolveCalendar, type SlaSettings } from '../utils/sla-settings.js';

/**
 * Bir şirketin SLA bağlamı: ayarlar + tatil günleri.
 *
 * Ticket açılışı, durum geçişi ve SLA işçisi aynı kaynaktan okur ki "hangi
 * takvim geçerli" sorusunun tek bir cevabı olsun.
 */
export interface CompanySlaContext {
  settings: SlaSettings;
  holidays: string[];
}

type SlaPrisma = Pick<PrismaClient, 'company' | 'companyHoliday'>;

export async function loadCompanySlaContext(prisma: SlaPrisma, companyId: string): Promise<CompanySlaContext> {
  const [company, holidays] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { slaSettings: true } }),
    prisma.companyHoliday.findMany({ where: { companyId }, select: { date: true } }),
  ]);
  return {
    settings: parseSlaSettings(company?.slaSettings),
    // `@db.Date` UTC gece yarısı olarak gelir; yerel gün = ISO tarih kısmı.
    holidays: holidays.map(h => h.date.toISOString().slice(0, 10)),
  };
}

export function calendarFor(context: CompanySlaContext, priority: Priority): BusinessCalendar | null {
  return resolveCalendar(context.settings, context.holidays, priority);
}

/** Bir işçi turunda aynı şirketi tekrar tekrar okumamak için tur-içi önbellek. */
export function createSlaContextCache(prisma: SlaPrisma) {
  const cache = new Map<string, Promise<CompanySlaContext>>();
  return (companyId: string) => {
    let entry = cache.get(companyId);
    if (!entry) {
      entry = loadCompanySlaContext(prisma, companyId);
      cache.set(companyId, entry);
    }
    return entry;
  };
}
