import type { PrismaClient } from '@prisma/client';
import type { EmailJobData, SmsJobData } from './queue.js';
import { renderHtmlTemplate, renderSubjectTemplate, renderTextTemplate, sendEmailForCompany } from '../services/email.service.js';
import { sendSms } from '../services/sms.service.js';

/**
 * Alıcının bildirim dilini çözer.
 *
 * Öncelik personeldedir: `to` bir personel e-postasıysa personelin dili kullanılır
 * (aksi hâlde bir SLA/kullanıcı-yanıtı bildirimi, talebi açan public kullanıcının
 * diline göre gönderilir — yanlış). Personel değilse talep sahibinin dili
 * (`ticket.locale`) kullanılır. İkisi de yoksa 'tr'.
 */
async function resolveRecipient(
  prisma: PrismaClient,
  to: string,
  ticketId?: string,
): Promise<{ locale: string; isStaff: boolean }> {
  const staff = await prisma.staff.findUnique({ where: { email: to }, select: { locale: true } });
  if (staff) return { locale: staff.locale, isStaff: true };
  if (ticketId) {
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { locale: true } });
    if (ticket?.locale) return { locale: ticket.locale, isStaff: false };
  }
  return { locale: 'tr', isStaff: false };
}

async function resolveRecipientLocale(prisma: PrismaClient, to: string, ticketId?: string): Promise<string> {
  return (await resolveRecipient(prisma, to, ticketId)).locale;
}

/**
 * Talep sahibine (personel olmayan alıcıya) giden bildirimde Reply-To: şirketin
 * aktif gelen posta kutusu varsa yanıtlar oraya gider ve ticket'a not olarak düşer.
 * Personele giden bildirimlerde kullanılmaz — personel yanıtı talep sahibi adına
 * kaydedilmemeli.
 */
async function resolveReplyTo(prisma: PrismaClient, companyId: string | undefined, isStaff: boolean): Promise<string | undefined> {
  if (isStaff || !companyId) return undefined;
  const mailbox = await prisma.companyMailbox.findUnique({ where: { companyId }, select: { address: true, isActive: true } });
  return mailbox?.isActive ? mailbox.address : undefined;
}

export async function processEmailJob(
  data: EmailJobData,
  prisma: PrismaClient,
  sender = sendEmailForCompany,
): Promise<void> {
  const { to, templateSlug, variables, ticketId, companyId } = data;
  // Public ticketless maillerde istekteki dil önce gelir (ör. Taleplerim);
  // personel/ticket çözümlemesi yalnızca verilmemişse devreye girer.
  const { locale, isStaff } = data.locale
    ? { locale: data.locale, isStaff: false }
    : await resolveRecipient(prisma, to, ticketId);
  // Alıcının dilinde şablon; yoksa Türkçeye düş.
  const template =
    (await prisma.emailTemplate.findFirst({ where: { slug: templateSlug, locale } })) ??
    (await prisma.emailTemplate.findFirst({ where: { slug: templateSlug, locale: 'tr' } }));
  if (!template) throw new Error(`Email template not found: ${templateSlug}`);

  const subject = renderSubjectTemplate(template.subject, variables);
  const html = renderHtmlTemplate(template.bodyHtml, variables);
  const text = renderTextTemplate(template.bodyText, variables);
  const smtpRecord = companyId
    ? await prisma.companySmtp.findUnique({ where: { companyId } })
    : null;
  const companySmtp = smtpRecord?.isActive ? {
    host: smtpRecord.host, port: smtpRecord.port, secure: smtpRecord.secure,
    user: smtpRecord.user, pass: smtpRecord.pass, fromName: smtpRecord.fromName,
    fromEmail: smtpRecord.fromEmail,
  } : null;

  const replyTo = await resolveReplyTo(prisma, companyId, isStaff);
  await sender({ to, subject, html, text, replyTo }, companyId || null, companySmtp);
  await prisma.notification.create({ data: {
    ticketId: ticketId || null, type: 'email', channel: templateSlug, recipient: to,
    subject, body: text, status: 'sent', sentAt: new Date(),
  } });
}

export async function processSmsJob(
  data: SmsJobData,
  prisma: PrismaClient,
  sender = sendSms,
): Promise<void> {
  const { to, templateSlug, variables, ticketId } = data;
  const locale = await resolveRecipientLocale(prisma, to, ticketId);
  const template =
    (await prisma.smsTemplate.findFirst({ where: { slug: templateSlug, locale } })) ??
    (await prisma.smsTemplate.findFirst({ where: { slug: templateSlug, locale: 'tr' } }));
  if (!template) throw new Error(`SMS template not found: ${templateSlug}`);
  const body = renderTextTemplate(template.body, variables);
  await sender({ to, body });
  await prisma.notification.create({ data: {
    ticketId: ticketId || null, type: 'sms', channel: templateSlug, recipient: to,
    body, status: 'sent', sentAt: new Date(),
  } });
}

export function isFinalAttempt(attemptsMade: number, attempts?: number): boolean {
  return attemptsMade >= (attempts || 3);
}
