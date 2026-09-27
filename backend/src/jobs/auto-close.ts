import { TicketStatus, type Prisma, type PrismaClient } from '@prisma/client';
import { config } from '../config/index.js';
import { autoCloseReasonText, waitingCloseNote } from '../i18n/labels.js';
import { calendarFor, createSlaContextCache } from '../services/sla-context.js';
import { parseSlaSettings } from '../utils/sla-settings.js';
import { planStatusTransition } from '../utils/ticket-lifecycle.js';
import { requesterSideRecipients } from '../services/ticket-relations.js';
import type { EmailJobData } from './queue.js';

/**
 * Otomatik kapatma turu.
 *
 * - `resolved` → N gün yeniden açılmazsa `closed`.
 * - `waiting_user_response` → N gün yanıt gelmezse önce hatırlatma, sonra `closed`.
 *
 * Süreler son durum değişikliğinden (`statusChangedAt`) sayılır ve şirket bazlıdır
 * (`sla_settings.autoClose`). Kapatma personel güncellemesiyle aynı planlayıcıdan
 * geçer (SLA devamı/çözüm ölçümü, erişim linki süresi, geçmiş kaydı); aktör sistemdir.
 */

export interface AutoCloseDeps {
  queueEmail: (data: EmailJobData) => Promise<unknown>;
  broadcastStaff: (event: string, data: unknown, companyId: string | null) => void;
  broadcastTicket: (accessToken: string, event: string, data: unknown) => void;
}

export interface AutoCloseResult {
  closed: number;
  reminded: number;
}

/** Tek turda şirket × kural başına işlenecek en fazla ticket (uzun kilitlenmeyi önler). */
const BATCH = 200;
const DAY = 24 * 60 * 60 * 1000;

type Reason = 'resolved' | 'no_response';

const ticketSelect = {
  id: true,
  ticketNumber: true,
  subject: true,
  status: true,
  priority: true,
  companyId: true,
  locale: true,
  accessToken: true,
  createdByEmail: true,
  createdBy: { select: { fullName: true } },
  firstRespondedAt: true,
  resolvedAt: true,
  slaResponseDue: true,
  slaResolveDue: true,
  slaResponseMet: true,
  slaResolveMet: true,
  slaResponseWarnAt: true,
  slaResolveWarnAt: true,
  slaPausedAt: true,
  slaPausedMinutes: true,
} satisfies Prisma.TicketSelect;

type TicketRow = Prisma.TicketGetPayload<{ select: typeof ticketSelect }>;

const trackingUrl = (accessToken: string) => `${config.CANONICAL_URL}/ticket/${accessToken}`;

export async function runAutoClose(prisma: PrismaClient, now: Date, deps: AutoCloseDeps): Promise<AutoCloseResult> {
  const result: AutoCloseResult = { closed: 0, reminded: 0 };
  const contextFor = createSlaContextCache(prisma);
  const companies = await prisma.company.findMany({ select: { id: true, slaSettings: true } });

  const findOlderThan = (companyId: string, status: TicketStatus, days: number, extra: Prisma.TicketWhereInput = {}) =>
    prisma.ticket.findMany({
      where: { companyId, status, statusChangedAt: { lte: new Date(now.getTime() - days * DAY) }, ...extra },
      select: ticketSelect,
      orderBy: { statusChangedAt: 'asc' },
      take: BATCH,
    });

  const close = async (ticket: TicketRow, reason: Reason, days: number) => {
    const calendar = calendarFor(await contextFor(ticket.companyId), ticket.priority);
    const plan = planStatusTransition(ticket, TicketStatus.closed, now, calendar);
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        ...plan.data,
        history: { create: [...plan.history, { action: 'auto_closed', field: 'status', newValue: reason }] },
      },
    });
    result.closed++;

    for (const to of await requesterSideRecipients(prisma, ticket)) {
      await deps.queueEmail({
        to,
        templateSlug: 'ticket_auto_closed',
        variables: {
          userName: to === ticket.createdByEmail.toLowerCase() ? (ticket.createdBy?.fullName ?? to) : to,
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          reasonText: autoCloseReasonText(ticket.locale, reason, days),
          trackingUrl: trackingUrl(ticket.accessToken),
        },
        ticketId: ticket.id,
        companyId: ticket.companyId,
      });
    }
    deps.broadcastStaff('ticket_updated', { id: ticket.id, ticketNumber: ticket.ticketNumber, status: TicketStatus.closed }, ticket.companyId);
    deps.broadcastTicket(ticket.accessToken, 'ticket_updated', { status: TicketStatus.closed, priority: ticket.priority });
  };

  for (const company of companies) {
    const { resolvedAfterDays, waitingReminderAfterDays, waitingCloseAfterDays } = parseSlaSettings(company.slaSettings).autoClose;

    if (resolvedAfterDays > 0) {
      for (const ticket of await findOlderThan(company.id, TicketStatus.resolved, resolvedAfterDays)) {
        await close(ticket, 'resolved', resolvedAfterDays);
      }
    }

    // Önce kapatma: kapatma eşiğini geçmiş ticket'a ayrıca hatırlatma gitmesin.
    if (waitingCloseAfterDays > 0) {
      for (const ticket of await findOlderThan(company.id, TicketStatus.waiting_user_response, waitingCloseAfterDays)) {
        await close(ticket, 'no_response', waitingCloseAfterDays);
      }
    }

    if (waitingReminderAfterDays > 0) {
      const due = await findOlderThan(company.id, TicketStatus.waiting_user_response, waitingReminderAfterDays, {
        autoCloseReminderAt: null,
      });
      for (const ticket of due) {
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: {
            autoCloseReminderAt: now,
            history: { create: { action: 'auto_close_reminder', field: 'status' } },
          },
        });
        result.reminded++;
        await deps.queueEmail({
          to: ticket.createdByEmail,
          templateSlug: 'ticket_waiting_reminder',
          variables: {
            userName: ticket.createdBy?.fullName ?? ticket.createdByEmail,
            ticketNumber: ticket.ticketNumber,
            subject: ticket.subject,
            closeNote: waitingCloseNote(
              ticket.locale,
              waitingCloseAfterDays > 0 ? waitingCloseAfterDays - waitingReminderAfterDays : null,
            ),
            trackingUrl: trackingUrl(ticket.accessToken),
          },
          ticketId: ticket.id,
          companyId: ticket.companyId,
        });
      }
    }
  }

  return result;
}
