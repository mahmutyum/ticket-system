import { Priority, StaffRole, type PrismaClient } from '@prisma/client';
import { PRIORITY_ORDER, SLA_FINAL_STATUSES } from '../config/constants.js';
import { config } from '../config/index.js';
import { formatDateTime, priorityLabel, slaTypeLabel, type SlaKind } from '../i18n/labels.js';
import { createSlaContextCache } from '../services/sla-context.js';
import type { EmailJobData } from './queue.js';

/**
 * SLA kontrol turu — ihlal öncesi uyarı, ihlal kaydı ve eskalasyon.
 *
 * BullMQ işçisinden ayrıldı ki bağımlılıkları (Prisma, e-posta kuyruğu, SSE)
 * enjekte edilerek test edilebilsin.
 *
 * Kurallar:
 * - Duraklatılmış (`slaPausedAt` dolu) ticket'lar hiç değerlendirilmez.
 * - Her uyarı ve ihlal ticket başına BİR kez işlenir: uyarı anı gönderimden
 *   sonra `null`lanır, ihlalde `slaXMet=false` yazılır.
 * - Atanmamış ticket'larda bildirim şirketin IT yöneticilerine gider (yoksa
 *   admin'lere) — kimsenin haberi olmadan ihlal gerçekleşmesin.
 */

export interface SlaCheckDeps {
  queueEmail: (data: EmailJobData) => Promise<unknown>;
  broadcast: (event: string, data: unknown, companyId: string | null) => void;
}

export interface SlaCheckResult {
  warnings: number;
  breaches: number;
  escalations: number;
}

interface Recipient {
  email: string;
  fullName: string;
  locale: string;
}

type TicketRow = Awaited<ReturnType<typeof findCandidates>>[number];

const KINDS: SlaKind[] = ['response', 'resolution'];

function findCandidates(prisma: PrismaClient, where: object) {
  return prisma.ticket.findMany({
    where: {
      ...where,
      slaPausedAt: null,
      status: { notIn: [...SLA_FINAL_STATUSES] },
    },
    select: {
      id: true,
      ticketNumber: true,
      subject: true,
      priority: true,
      companyId: true,
      slaResponseDue: true,
      slaResolveDue: true,
      company: { select: { name: true } },
      assignedTo: { select: { email: true, fullName: true, locale: true, isActive: true } },
    },
  });
}

/** Şirketin aktif IT yöneticileri; hiç yoksa aktif admin'ler. */
async function findManagers(prisma: PrismaClient, companyId: string): Promise<Recipient[]> {
  const select = { email: true, fullName: true, locale: true };
  const managers = await prisma.staff.findMany({
    where: { isActive: true, role: StaffRole.it_manager, assignedCompanies: { some: { companyId } } },
    select,
  });
  if (managers.length > 0) return managers;
  return prisma.staff.findMany({ where: { isActive: true, role: StaffRole.admin }, select });
}

function nextPriority(priority: Priority): Priority | null {
  const i = PRIORITY_ORDER.indexOf(priority);
  return i >= 0 && i < PRIORITY_ORDER.length - 1 ? PRIORITY_ORDER[i + 1] : null;
}

const staffTicketUrl = (id: string) => `${config.CANONICAL_URL}/staff/tickets/${id}`;

export async function runSlaCheck(prisma: PrismaClient, now: Date, deps: SlaCheckDeps): Promise<SlaCheckResult> {
  const result: SlaCheckResult = { warnings: 0, breaches: 0, escalations: 0 };
  const contextFor = createSlaContextCache(prisma);
  const managerCache = new Map<string, Promise<Recipient[]>>();
  const managersFor = (companyId: string) => {
    let entry = managerCache.get(companyId);
    if (!entry) {
      entry = findManagers(prisma, companyId);
      managerCache.set(companyId, entry);
    }
    return entry;
  };

  const assigneeOf = (ticket: TicketRow): Recipient | null =>
    ticket.assignedTo?.isActive ? ticket.assignedTo : null;

  const notify = async (ticket: TicketRow, to: Recipient, templateSlug: string, kind: SlaKind, extra: Record<string, string> = {}) => {
    await deps.queueEmail({
      to: to.email,
      templateSlug,
      variables: {
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        companyName: ticket.company.name,
        slaType: slaTypeLabel(to.locale, kind),
        staffName: to.fullName,
        priority: priorityLabel(to.locale, ticket.priority),
        ticketUrl: staffTicketUrl(ticket.id),
        ...extra,
      },
      ticketId: ticket.id,
      companyId: ticket.companyId,
    });
  };

  // 1) İHLALLER — önce işlenir; ihlal edilen hedefin bekleyen uyarısı da temizlenir.
  for (const kind of KINDS) {
    const tickets = await findCandidates(
      prisma,
      kind === 'response'
        ? { slaResponseDue: { lt: now }, slaResponseMet: null, firstRespondedAt: null }
        : { slaResolveDue: { lt: now }, slaResolveMet: null, resolvedAt: null },
    );

    for (const ticket of tickets) {
      const settings = (await contextFor(ticket.companyId)).settings;
      const bump = kind === 'resolution' && settings.escalation.bumpPriority ? nextPriority(ticket.priority) : null;

      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          ...(kind === 'response'
            ? { slaResponseMet: false, slaResponseWarnAt: null }
            : { slaResolveMet: false, slaResolveWarnAt: null }),
          ...(bump ? { priority: bump } : {}),
          history: {
            create: [
              { action: 'sla_violated', field: kind === 'response' ? 'sla_response' : 'sla_resolution', newValue: kind },
              ...(bump
                ? [{ action: 'priority_changed', field: 'priority', oldValue: ticket.priority, newValue: bump }]
                : []),
            ],
          },
        },
      });
      result.breaches++;

      const assignee = assigneeOf(ticket);
      if (assignee) await notify(ticket, assignee, 'sla_warning', kind);

      // Eskalasyon: ayar açıksa ya da ticket atanmamışsa (başka kimse bilmez).
      if (settings.escalation.notifyManagers || !assignee) {
        const managers = (await managersFor(ticket.companyId)).filter(m => m.email !== assignee?.email);
        for (const manager of managers) {
          await notify(ticket, manager, 'sla_escalation', kind, {
            assigneeName: assignee?.fullName ?? '—',
          });
        }
        if (managers.length > 0) {
          await prisma.ticketHistory.create({
            data: { ticketId: ticket.id, action: 'sla_escalated', field: 'sla', newValue: kind },
          });
          result.escalations++;
        }
      }

      deps.broadcast('sla_alert', {
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        kind,
        level: 'breached',
      }, ticket.companyId);
    }
  }

  // 2) İHLAL ÖNCESİ UYARILAR
  for (const kind of KINDS) {
    const tickets = await findCandidates(
      prisma,
      kind === 'response'
        ? { slaResponseWarnAt: { lte: now }, slaResponseMet: null, firstRespondedAt: null }
        : { slaResolveWarnAt: { lte: now }, slaResolveMet: null, resolvedAt: null },
    );

    for (const ticket of tickets) {
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          ...(kind === 'response' ? { slaResponseWarnAt: null } : { slaResolveWarnAt: null }),
          history: { create: { action: 'sla_warning', field: 'sla', newValue: kind } },
        },
      });
      result.warnings++;

      const due = kind === 'response' ? ticket.slaResponseDue : ticket.slaResolveDue;
      // Son tarih şirketin mesai saat diliminde gösterilir (tanımlıysa).
      const timeZone = (await contextFor(ticket.companyId)).settings.businessHours?.timezone;
      const assignee = assigneeOf(ticket);
      const recipients = assignee ? [assignee] : await managersFor(ticket.companyId);
      for (const to of recipients) {
        await notify(ticket, to, 'sla_approaching', kind, {
          dueAt: due ? formatDateTime(to.locale, due, timeZone) : '—',
        });
      }

      deps.broadcast('sla_alert', {
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        kind,
        level: 'approaching',
      }, ticket.companyId);
    }
  }

  return result;
}
