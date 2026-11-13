import { TicketStatus } from '../config/constants.js';
import { type PrismaClient } from '@prisma/client';

/**
 * Ticket ilişkileri: birleştirme, üst/alt, izleyiciler (CC).
 *
 * Doğrulama kuralları SAF fonksiyonlardır (test edilebilir); bildirim alıcılarını
 * çözen yardımcılar veritabanından okur.
 */

export interface RelationTicket {
  id: string;
  companyId: string;
  status: string;
  parentId: string | null;
  mergedIntoId: string | null;
}

/** Birleştirme mümkün mü? Hata anahtarı (i18n) ya da null. */
export function mergeError(source: RelationTicket, target: RelationTicket): string | null {
  if (source.id === target.id) return 'tickets.merge_self';
  if (source.companyId !== target.companyId) return 'tickets.merge_other_company';
  if (source.mergedIntoId) return 'tickets.merge_already_merged';
  if (target.mergedIntoId) return 'tickets.merge_target_merged';
  if (target.status === TicketStatus.closed) return 'tickets.merge_target_closed';
  return null;
}

/**
 * Üst ticket atanabilir mi? Tek seviye hiyerarşi: üst ticket'ın kendi üstü olamaz,
 * alt ticket'ların altı olamaz. Böylece döngü imkânsızdır ve "yaygın arıza → etkilenen
 * talepler" modeli sade kalır.
 */
export function parentError(child: RelationTicket, parent: RelationTicket, childHasChildren: boolean): string | null {
  if (child.id === parent.id) return 'tickets.parent_self';
  if (child.companyId !== parent.companyId) return 'tickets.parent_other_company';
  if (parent.parentId) return 'tickets.parent_is_child';
  if (childHasChildren) return 'tickets.parent_child_has_children';
  if (parent.mergedIntoId || child.mergedIntoId) return 'tickets.parent_merged';
  return null;
}

type WatcherPrisma = Pick<PrismaClient, 'ticketWatcher'>;

const uniqueLower = (emails: string[]) => [...new Set(emails.map(e => e.toLowerCase()))];

/**
 * Talep sahibi tarafındaki alıcılar: talep sahibi + personel olmayan izleyiciler (CC).
 * `exclude` (ör. yanıtı yazan kişi) listeden çıkarılır.
 */
export async function requesterSideRecipients(
  prisma: WatcherPrisma,
  ticket: { id: string; createdByEmail: string },
  exclude: string[] = [],
): Promise<string[]> {
  const watchers = await prisma.ticketWatcher.findMany({
    where: { ticketId: ticket.id, staffId: null },
    select: { email: true },
  });
  const skip = new Set(exclude.map(e => e.toLowerCase()));
  return uniqueLower([ticket.createdByEmail, ...watchers.map(w => w.email)]).filter(e => !skip.has(e));
}

/** Personel izleyiciler (aktif olanlar). */
export async function staffWatchers(
  prisma: WatcherPrisma,
  ticketId: string,
  exclude: string[] = [],
): Promise<Array<{ email: string; fullName: string }>> {
  const rows = await prisma.ticketWatcher.findMany({
    where: { ticketId, staffId: { not: null }, staff: { isActive: true } },
    select: { staff: { select: { email: true, fullName: true } } },
  });
  const skip = new Set(exclude.map(e => e.toLowerCase()));
  return rows
    .map(r => r.staff!)
    .filter(s => !skip.has(s.email.toLowerCase()));
}

/** Bu adres ticket'ın talep sahibi tarafında mı (talep sahibi ya da CC)? */
export async function isRequesterSide(
  prisma: WatcherPrisma,
  ticket: { id: string; createdByEmail: string },
  email: string,
): Promise<boolean> {
  if (ticket.createdByEmail.toLowerCase() === email.toLowerCase()) return true;
  const watcher = await prisma.ticketWatcher.findFirst({
    where: { ticketId: ticket.id, staffId: null, email: email.toLowerCase() },
    select: { id: true },
  });
  return !!watcher;
}

/** CC listesi normalizasyonu: küçük harf, tekil, talep sahibi/hariç tutulanlar çıkarılmış, en fazla `max`. */
export function normalizeCc(emails: string[], exclude: string[], max = 10): string[] {
  const skip = new Set(exclude.map(e => e.toLowerCase()));
  return uniqueLower(emails.filter(Boolean)).filter(e => !skip.has(e)).slice(0, max);
}
