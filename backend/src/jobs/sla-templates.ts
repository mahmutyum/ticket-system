import type { PrismaClient } from '@prisma/client';

/**
 * SLA uyarı/eskalasyon e-posta şablonlarını garanti eder (v1.1).
 *
 * Seed yalnızca ilk kurulumda çalışır; mevcut kurulumlara yeni şablonlar
 * açılışta eklenir. Var olan şablona dokunulmaz — yönetici şablon editöründen
 * düzenlemiş olabilir.
 */

const button = (label: string) =>
  `<p><a href="{{ticketUrl}}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">${label}</a></p>`;

export const SLA_EMAIL_TEMPLATES = [
  {
    slug: 'sla_approaching',
    locale: 'tr',
    subject: 'SLA Süresi Dolmak Üzere - {{ticketNumber}}',
    bodyHtml: `<h2>SLA Süresi Dolmak Üzere</h2>
<p>Sayın {{staffName}},</p>
<p><strong>{{ticketNumber}}</strong> numaralı talebin <strong>{{slaType}}</strong> hedefi yaklaşıyor.</p>
<ul>
  <li><strong>Son tarih:</strong> {{dueAt}}</li>
  <li><strong>Şirket:</strong> {{companyName}}</li>
  <li><strong>Konu:</strong> {{subject}}</li>
  <li><strong>Öncelik:</strong> {{priority}}</li>
</ul>
${button('Talebi Görüntüle')}`,
    bodyText: 'SLA yaklaşıyor: {{ticketNumber}} - {{slaType}}, son tarih {{dueAt}}. Konu: {{subject}}. {{ticketUrl}}',
    variables: ['ticketNumber', 'staffName', 'slaType', 'dueAt', 'companyName', 'subject', 'priority', 'ticketUrl'],
  },
  {
    slug: 'sla_approaching',
    locale: 'en',
    subject: 'SLA Deadline Approaching - {{ticketNumber}}',
    bodyHtml: `<h2>SLA Deadline Approaching</h2>
<p>Dear {{staffName}},</p>
<p>The <strong>{{slaType}}</strong> target for request <strong>{{ticketNumber}}</strong> is approaching.</p>
<ul>
  <li><strong>Due:</strong> {{dueAt}}</li>
  <li><strong>Company:</strong> {{companyName}}</li>
  <li><strong>Subject:</strong> {{subject}}</li>
  <li><strong>Priority:</strong> {{priority}}</li>
</ul>
${button('View Request')}`,
    bodyText: 'SLA approaching: {{ticketNumber}} - {{slaType}}, due {{dueAt}}. Subject: {{subject}}. {{ticketUrl}}',
    variables: ['ticketNumber', 'staffName', 'slaType', 'dueAt', 'companyName', 'subject', 'priority', 'ticketUrl'],
  },
  {
    slug: 'sla_escalation',
    locale: 'tr',
    subject: 'SLA İhlali Eskalasyonu - {{ticketNumber}}',
    bodyHtml: `<h2>SLA İhlali — Eskalasyon</h2>
<p>Sayın {{staffName}},</p>
<p><strong>{{ticketNumber}}</strong> numaralı talep için <strong>{{slaType}}</strong> hedefi aşıldı.</p>
<ul>
  <li><strong>Atanan:</strong> {{assigneeName}}</li>
  <li><strong>Şirket:</strong> {{companyName}}</li>
  <li><strong>Konu:</strong> {{subject}}</li>
  <li><strong>Öncelik:</strong> {{priority}}</li>
</ul>
${button('Talebi Görüntüle')}`,
    bodyText: 'SLA ihlali (eskalasyon): {{ticketNumber}} - {{slaType}} aşıldı. Atanan: {{assigneeName}}. {{ticketUrl}}',
    variables: ['ticketNumber', 'staffName', 'slaType', 'assigneeName', 'companyName', 'subject', 'priority', 'ticketUrl'],
  },
  {
    slug: 'sla_escalation',
    locale: 'en',
    subject: 'SLA Breach Escalation - {{ticketNumber}}',
    bodyHtml: `<h2>SLA Breach — Escalation</h2>
<p>Dear {{staffName}},</p>
<p>The <strong>{{slaType}}</strong> target for request <strong>{{ticketNumber}}</strong> has been exceeded.</p>
<ul>
  <li><strong>Assignee:</strong> {{assigneeName}}</li>
  <li><strong>Company:</strong> {{companyName}}</li>
  <li><strong>Subject:</strong> {{subject}}</li>
  <li><strong>Priority:</strong> {{priority}}</li>
</ul>
${button('View Request')}`,
    bodyText: 'SLA breach (escalation): {{ticketNumber}} - {{slaType}} exceeded. Assignee: {{assigneeName}}. {{ticketUrl}}',
    variables: ['ticketNumber', 'staffName', 'slaType', 'assigneeName', 'companyName', 'subject', 'priority', 'ticketUrl'],
  },
];

export async function ensureSlaEmailTemplates(prisma: Pick<PrismaClient, 'emailTemplate'>) {
  for (const tmpl of SLA_EMAIL_TEMPLATES) {
    await prisma.emailTemplate.upsert({
      where: { slug_locale: { slug: tmpl.slug, locale: tmpl.locale } },
      update: {},
      create: tmpl,
    });
  }
}
