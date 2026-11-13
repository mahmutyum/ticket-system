import { TicketStatus } from '../config/constants.js';
import { nanoid } from 'nanoid';
import { type PrismaClient } from '@prisma/client';
import { config } from '../config/index.js';
import type { EmailJobData, SmsJobData } from '../jobs/queue.js';
import { priorityLabel } from '../i18n/labels.js';
import { calculateSlaDueDates } from '../utils/sla.js';
import { generateTicketNumber } from '../utils/ticket-number.js';
import { planStatusTransition } from '../utils/ticket-lifecycle.js';
import { calendarFor, loadCompanySlaContext } from './sla-context.js';
import { normalizeCc, staffWatchers } from './ticket-relations.js';
import { emitTicketEvent } from './webhooks/emit.js';

/**
 * Talep sahibi tarafındaki ticket işlemleri — portal (HTTP) ve e-posta (gelen
 * kutusu) kanallarının ORTAK yolu.
 *
 * Kanal-özgü denetimler (portal domain kilidi, rate limit, access token, e-posta
 * döngü koruması) çağıranda kalır; burada yalnızca her kanalda aynı olması
 * gereken iş kuralları yaşar: kullanıcı kaydı, SLA, bildirimler, geçmiş, SSE.
 */

export interface IntakeDeps {
  queueEmail: (data: EmailJobData) => Promise<unknown>;
  queueSms: (data: SmsJobData) => Promise<unknown>;
  broadcastStaff: (event: string, data: unknown, companyId: string | null) => void;
}

export interface NewRequesterTicket {
  companyId: string;
  locationId: string;
  categoryId: string;
  email: string;
  fullName: string;
  phone?: string;
  department?: string;
  subject: string;
  description: string;
  priority: string;
  locale: 'tr' | 'en';
  customFields?: Array<{ fieldId: string; value: string }>;
  source?: 'portal' | 'email';
  /** Talep sahibi tarafında bilgilendirilecek ek adresler (CC). Çağıran domain kuralını uygular. */
  ccEmails?: string[];
}

export const trackingUrlFor = (accessToken: string) => `${config.CANONICAL_URL}/ticket/${accessToken}`;

/** E-posta adresinin şirketin izinli domain'lerinden biri olup olmadığı (liste boşsa serbest). */
export function isEmailDomainAllowed(allowedDomains: unknown, email: string): boolean {
  const domains = Array.isArray(allowedDomains) ? (allowedDomains as string[]) : [];
  if (domains.length === 0) return true;
  const emailDomain = email.split('@')[1]?.toLowerCase();
  return domains.some(d => d.toLowerCase() === emailDomain);
}

export async function createRequesterTicket(prisma: PrismaClient, input: NewRequesterTicket, deps: IntakeDeps) {
  // Find or create user
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  const user = existing
    ? await prisma.user.update({
        where: { email: input.email },
        data: {
          fullName: input.fullName,
          phone: input.phone || existing.phone,
          companyId: input.companyId,
          locationId: input.locationId,
          department: input.department || existing.department,
        },
      })
    : await prisma.user.create({
        data: {
          email: input.email,
          fullName: input.fullName,
          phone: input.phone,
          companyId: input.companyId,
          locationId: input.locationId,
          department: input.department,
        },
      });

  const ticketNumber = await generateTicketNumber();
  const accessToken = nanoid(32);
  const now = new Date();

  const category = await prisma.category.findUnique({ where: { id: input.categoryId } });
  // Mesai takvimi + ihlal öncesi uyarı eşiği şirket ayarlarından gelir.
  const slaContext = await loadCompanySlaContext(prisma, input.companyId);
  const { slaResponseDue, slaResolveDue, slaResponseWarnAt, slaResolveWarnAt } = calculateSlaDueDates(
    category,
    now,
    { calendar: calendarFor(slaContext, input.priority), warningPercent: slaContext.settings.warningPercent },
  );

  const ticket = await prisma.ticket.create({
    data: {
      ticketNumber,
      companyId: input.companyId,
      locationId: input.locationId,
      categoryId: input.categoryId,
      createdByEmail: input.email,
      createdByUserId: user.id,
      subject: input.subject,
      description: input.description,
      priority: input.priority,
      locale: input.locale,
      source: input.source ?? 'portal',
      accessToken,
      slaResponseDue,
      slaResolveDue,
      slaResponseWarnAt,
      slaResolveWarnAt,
      statusChangedAt: now,
      // Auto-assign if category has it set
      assignedToId: category?.autoAssignTo || undefined,
      customValues: input.customFields
        ? { create: input.customFields.map(cf => ({ customFieldId: cf.fieldId, value: cf.value })) }
        : undefined,
      history: {
        create: { action: 'ticket_created', newValue: 'open', createdByEmail: input.email },
      },
      watchers: input.ccEmails?.length
        ? { create: normalizeCc(input.ccEmails, [input.email]).map(email => ({ email, addedBy: input.email })) }
        : undefined,
    },
    include: {
      company: { select: { name: true, notificationEmail: true } },
      category: { select: { name: true } },
    },
  });

  const trackingUrl = trackingUrlFor(accessToken);
  await deps.queueEmail({
    to: input.email,
    templateSlug: 'ticket_created',
    variables: {
      ticketNumber,
      userName: input.fullName,
      subject: input.subject,
      priority: priorityLabel(input.locale, input.priority),
      trackingUrl,
    },
    ticketId: ticket.id,
    companyId: input.companyId,
  });

  if (input.phone) {
    await deps.queueSms({
      to: input.phone,
      templateSlug: 'ticket_created',
      variables: { ticketNumber, trackingUrl },
      ticketId: ticket.id,
    });
  }

  // Notify company's IT group email
  if (ticket.company.notificationEmail) {
    await deps.queueEmail({
      to: ticket.company.notificationEmail,
      templateSlug: 'ticket_created_internal',
      variables: {
        ticketNumber,
        companyName: ticket.company.name,
        userName: input.fullName,
        userEmail: input.email,
        subject: input.subject,
        priority: input.priority,
        categoryName: ticket.category?.name || '-',
        staffUrl: `${config.CANONICAL_URL}/staff/tickets/${ticket.id}`,
      },
      ticketId: ticket.id,
      companyId: input.companyId,
    });
  }

  await emitTicketEvent(prisma, 'ticket.created', ticket.id);

  deps.broadcastStaff('ticket_created', {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    status: ticket.status,
    priority: input.priority,
    company: ticket.company.name,
  }, ticket.companyId);

  return ticket;
}

/** `addRequesterReply` için gereken ticket alanları. */
export const replyTicketSelect = {
  id: true,
  ticketNumber: true,
  companyId: true,
  createdByEmail: true,
  assignedToId: true,
  status: true,
  priority: true,
  accessTokenExpiresAt: true,
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
  assignedTo: { select: { email: true, fullName: true } },
} as const;

type ReplyTicket = Parameters<typeof planStatusTransition>[0] & {
  id: string;
  ticketNumber: string;
  companyId: string;
  createdByEmail: string;
  priority: string;
  assignedTo: { email: string; fullName: string } | null;
};

/**
 * Talep sahibi yanıtı: geçmişe yazılır, IT bilgilendirilir.
 *
 * Kullanıcı yanıt verdiyse "yanıt bekleniyor" biter: ticket tekrar ele alınmak
 * üzere `open`a döner ve duraklatılan SLA devam eder. E-posta kanalında çözülmüş
 * bir ticket'a gelen yanıt da (`reopenResolved`) ticket'ı yeniden açar — kullanıcı
 * "hâlâ çalışmıyor" diye yanıtlamıştır.
 */
export async function addRequesterReply(
  prisma: PrismaClient,
  ticket: ReplyTicket,
  content: string,
  deps: Pick<IntakeDeps, 'queueEmail' | 'broadcastStaff'>,
  options: { via?: 'portal' | 'email'; reopenResolved?: boolean; authorEmail?: string } = {},
): Promise<void> {
  // Yanıtı yazan: talep sahibi ya da (e-postayla yanıt veren) bir CC izleyicisi.
  const author = options.authorEmail ?? ticket.createdByEmail;
  const reopen =
    ticket.status === TicketStatus.waiting_user_response ||
    (options.reopenResolved === true && ticket.status === TicketStatus.resolved);
  const plan = reopen
    ? planStatusTransition(
        ticket,
        TicketStatus.open,
        new Date(),
        calendarFor(await loadCompanySlaContext(prisma, ticket.companyId), ticket.priority),
        { email: author },
      )
    : null;

  // Create history + update status atomically
  await prisma.$transaction(async (tx) => {
    await tx.ticketHistory.create({
      data: {
        ticketId: ticket.id,
        action: 'user_reply',
        field: options.via === 'email' ? 'email' : null,
        newValue: content,
        createdByEmail: author,
      },
    });
    if (plan) {
      await tx.ticket.update({
        where: { id: ticket.id },
        data: { ...plan.data, history: { create: plan.history } },
      });
    }
  });

  deps.broadcastStaff('user_reply', {
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumber,
    email: author,
    content: content.substring(0, 100),
  }, ticket.companyId);

  await emitTicketEvent(prisma, 'ticket.user_reply', ticket.id, { excerpt: content.substring(0, 200), author, via: options.via ?? 'portal' });
  if (plan) await emitTicketEvent(prisma, 'ticket.status_changed', ticket.id, { from: ticket.status, to: TicketStatus.open });

  // Atanan + personel izleyiciler (aynı kişiye iki kez gitmez).
  const recipients = [
    ...(ticket.assignedTo?.email ? [ticket.assignedTo] : []),
    ...(await staffWatchers(prisma, ticket.id, ticket.assignedTo?.email ? [ticket.assignedTo.email] : [])),
  ];
  for (const staff of recipients) {
    await deps.queueEmail({
      to: staff.email,
      templateSlug: 'user_reply',
      variables: {
        ticketNumber: ticket.ticketNumber,
        staffName: staff.fullName,
        userEmail: author,
        replyContent: content.substring(0, 500),
      },
      ticketId: ticket.id,
      companyId: ticket.companyId,
    });
  }
}
