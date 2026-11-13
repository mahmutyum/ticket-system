import { TicketStatus } from '../config/constants.js';
import { type PrismaClient } from '@prisma/client';
import type { EmailJobData } from '../jobs/queue.js';
import { parseSlaSettings } from '../utils/sla-settings.js';
import { trackingUrlFor } from './ticket-intake.js';

/**
 * Memnuniyet anketi (CSAT).
 *
 * Çözüm/kapanıştan sonra talep sahibine BİR KEZ anket e-postası gider (şirket ayarı
 * açıksa). E-postadaki yıldız bağlantıları puanı yalnızca ÖNCEDEN SEÇER — oylama
 * sayfada onayla yapılır: e-posta güvenlik tarayıcıları bağlantıları otomatik açar,
 * GET ile oy kaydetmek sahte puanlar üretirdi.
 */
export async function maybeSendSurvey(
  prisma: PrismaClient,
  ticketId: string,
  queueEmail: (data: EmailJobData) => Promise<unknown>,
): Promise<boolean> {
  // Anket yan etkidir: hatası ticket işlemini (durum güncellemesi, otomatik kapatma) bozmamalı.
  try {
    return await sendSurvey(prisma, ticketId, queueEmail);
  } catch (err) {
    console.error('[Survey] failed', ticketId, err);
    return false;
  }
}

async function sendSurvey(
  prisma: PrismaClient,
  ticketId: string,
  queueEmail: (data: EmailJobData) => Promise<unknown>,
): Promise<boolean> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true, ticketNumber: true, subject: true, status: true, companyId: true, accessToken: true,
      createdByEmail: true, surveySentAt: true, satisfactionRating: true, mergedIntoId: true,
      createdBy: { select: { fullName: true } },
      company: { select: { slaSettings: true } },
    },
  });
  if (!ticket) return false;
  const final = ticket.status === TicketStatus.resolved || ticket.status === TicketStatus.closed;
  // Birleştirilen (mükerrer) talep için anket sorulmaz — hizmet hedef talepte verildi.
  if (!final || ticket.surveySentAt || ticket.satisfactionRating || ticket.mergedIntoId) return false;
  if (!parseSlaSettings(ticket.company.slaSettings).satisfactionSurvey) return false;

  // Yarış: iki geçiş aynı anda gelirse yalnızca biri "gönderildi" işaretini alır.
  const claimed = await prisma.ticket.updateMany({
    where: { id: ticket.id, surveySentAt: null },
    data: { surveySentAt: new Date() },
  });
  if (claimed.count === 0) return false;

  await queueEmail({
    to: ticket.createdByEmail,
    templateSlug: 'ticket_survey',
    variables: {
      userName: ticket.createdBy?.fullName ?? ticket.createdByEmail,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      trackingUrl: trackingUrlFor(ticket.accessToken),
    },
    ticketId: ticket.id,
    companyId: ticket.companyId,
  });
  return true;
}
