import type { PrismaClient } from '@prisma/client';

/**
 * v1.1 ile eklenen sistem e-posta şablonlarını garanti eder: SLA uyarı /
 * eskalasyon ve otomatik kapatma (bekleme hatırlatması, kapatıldı bildirimi).
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

const trackingButton = (label: string) =>
  `<p><a href="{{trackingUrl}}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">${label}</a></p>`;

export const AUTO_CLOSE_EMAIL_TEMPLATES = [
  {
    slug: 'ticket_waiting_reminder',
    locale: 'tr',
    subject: 'Yanıtınızı Bekliyoruz - {{ticketNumber}}',
    bodyHtml: `<h2>Yanıtınızı Bekliyoruz</h2>
<p>Sayın {{userName}},</p>
<p><strong>{{ticketNumber}}</strong> numaralı talebiniz (<em>{{subject}}</em>) için IT ekibi sizden bilgi bekliyor.</p>
<p>{{closeNote}}</p>
${trackingButton('Talebe Yanıt Ver')}`,
    bodyText: 'Yanıtınızı bekliyoruz: {{ticketNumber}} - {{subject}}. {{closeNote}} Yanıt vermek için: {{trackingUrl}}',
    variables: ['userName', 'ticketNumber', 'subject', 'closeNote', 'trackingUrl'],
  },
  {
    slug: 'ticket_waiting_reminder',
    locale: 'en',
    subject: 'We Are Waiting for Your Reply - {{ticketNumber}}',
    bodyHtml: `<h2>We Are Waiting for Your Reply</h2>
<p>Dear {{userName}},</p>
<p>The IT team is waiting for information from you on request <strong>{{ticketNumber}}</strong> (<em>{{subject}}</em>).</p>
<p>{{closeNote}}</p>
${trackingButton('Reply to Request')}`,
    bodyText: 'We are waiting for your reply: {{ticketNumber}} - {{subject}}. {{closeNote}} Reply here: {{trackingUrl}}',
    variables: ['userName', 'ticketNumber', 'subject', 'closeNote', 'trackingUrl'],
  },
  {
    slug: 'ticket_auto_closed',
    locale: 'tr',
    subject: 'Talebiniz Kapatıldı - {{ticketNumber}}',
    bodyHtml: `<h2>Talebiniz Kapatıldı</h2>
<p>Sayın {{userName}},</p>
<p><strong>{{ticketNumber}}</strong> numaralı talebiniz (<em>{{subject}}</em>) otomatik olarak kapatıldı.</p>
<p>{{reasonText}}</p>
<p>Sorununuz devam ediyorsa yeni bir talep oluşturabilirsiniz.</p>
${trackingButton('Talebi Görüntüle')}`,
    bodyText: 'Talebiniz kapatıldı: {{ticketNumber}} - {{subject}}. {{reasonText}} Detay: {{trackingUrl}}',
    variables: ['userName', 'ticketNumber', 'subject', 'reasonText', 'trackingUrl'],
  },
  {
    slug: 'ticket_auto_closed',
    locale: 'en',
    subject: 'Your Request Was Closed - {{ticketNumber}}',
    bodyHtml: `<h2>Your Request Was Closed</h2>
<p>Dear {{userName}},</p>
<p>Your request <strong>{{ticketNumber}}</strong> (<em>{{subject}}</em>) was closed automatically.</p>
<p>{{reasonText}}</p>
<p>If the issue persists, please open a new request.</p>
${trackingButton('View Request')}`,
    bodyText: 'Your request was closed: {{ticketNumber}} - {{subject}}. {{reasonText}} Details: {{trackingUrl}}',
    variables: ['userName', 'ticketNumber', 'subject', 'reasonText', 'trackingUrl'],
  },
];

export const MERGE_EMAIL_TEMPLATES = [
  {
    slug: 'ticket_merged',
    locale: 'tr',
    subject: 'Talebiniz Birleştirildi - {{ticketNumber}}',
    bodyHtml: `<h2>Talebiniz Birleştirildi</h2>
<p>Sayın {{userName}},</p>
<p><strong>{{ticketNumber}}</strong> numaralı talebiniz aynı konudaki <strong>{{targetTicketNumber}}</strong> numaralı talep ile birleştirildi.</p>
<p>Bundan sonraki gelişmeler hakkında <strong>{{targetTicketNumber}}</strong> üzerinden bilgilendirileceksiniz.</p>`,
    bodyText: 'Talebiniz {{ticketNumber}}, {{targetTicketNumber}} ile birleştirildi. Gelişmeler {{targetTicketNumber}} üzerinden bildirilecek.',
    variables: ['userName', 'ticketNumber', 'targetTicketNumber'],
  },
  {
    slug: 'ticket_merged',
    locale: 'en',
    subject: 'Your Request Was Merged - {{ticketNumber}}',
    bodyHtml: `<h2>Your Request Was Merged</h2>
<p>Dear {{userName}},</p>
<p>Your request <strong>{{ticketNumber}}</strong> was merged into request <strong>{{targetTicketNumber}}</strong> about the same issue.</p>
<p>You will receive further updates through <strong>{{targetTicketNumber}}</strong>.</p>`,
    bodyText: 'Your request {{ticketNumber}} was merged into {{targetTicketNumber}}. Updates will follow via {{targetTicketNumber}}.',
    variables: ['userName', 'ticketNumber', 'targetTicketNumber'],
  },
];

export const SURVEY_EMAIL_TEMPLATES = [
  {
    slug: 'ticket_survey',
    locale: 'tr',
    subject: 'Talebiniz Hakkında Görüşünüz - {{ticketNumber}}',
    bodyHtml: `<h2>Hizmetimizi Değerlendirin</h2>
<p>Sayın {{userName}},</p>
<p><strong>{{ticketNumber}}</strong> numaralı talebiniz (<em>{{subject}}</em>) sonuçlandı. Aldığınız destekten ne kadar memnun kaldınız?</p>
<p><a href="{{trackingUrl}}?rate=1#satisfaction" style="display:inline-block;margin:0 4px;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;text-decoration:none;color:#111;">★</a><a href="{{trackingUrl}}?rate=2#satisfaction" style="display:inline-block;margin:0 4px;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;text-decoration:none;color:#111;">★★</a><a href="{{trackingUrl}}?rate=3#satisfaction" style="display:inline-block;margin:0 4px;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;text-decoration:none;color:#111;">★★★</a><a href="{{trackingUrl}}?rate=4#satisfaction" style="display:inline-block;margin:0 4px;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;text-decoration:none;color:#111;">★★★★</a><a href="{{trackingUrl}}?rate=5#satisfaction" style="display:inline-block;margin:0 4px;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;text-decoration:none;color:#111;">★★★★★</a></p>
<p style="color:#666;font-size:12px;">Bir yıldıza tıkladıktan sonra açılan sayfada puanınızı onaylayabilir ve isterseniz yorum ekleyebilirsiniz.</p>`,
    bodyText: 'Talebiniz {{ticketNumber}} sonuçlandı. Değerlendirmek için: {{trackingUrl}}#satisfaction',
    variables: ['userName', 'ticketNumber', 'subject', 'trackingUrl'],
  },
  {
    slug: 'ticket_survey',
    locale: 'en',
    subject: 'How Did We Do? - {{ticketNumber}}',
    bodyHtml: `<h2>Rate Our Support</h2>
<p>Dear {{userName}},</p>
<p>Your request <strong>{{ticketNumber}}</strong> (<em>{{subject}}</em>) has been completed. How satisfied are you with the support you received?</p>
<p><a href="{{trackingUrl}}?rate=1#satisfaction" style="display:inline-block;margin:0 4px;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;text-decoration:none;color:#111;">★</a><a href="{{trackingUrl}}?rate=2#satisfaction" style="display:inline-block;margin:0 4px;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;text-decoration:none;color:#111;">★★</a><a href="{{trackingUrl}}?rate=3#satisfaction" style="display:inline-block;margin:0 4px;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;text-decoration:none;color:#111;">★★★</a><a href="{{trackingUrl}}?rate=4#satisfaction" style="display:inline-block;margin:0 4px;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;text-decoration:none;color:#111;">★★★★</a><a href="{{trackingUrl}}?rate=5#satisfaction" style="display:inline-block;margin:0 4px;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;text-decoration:none;color:#111;">★★★★★</a></p>
<p style="color:#666;font-size:12px;">After clicking a star you can confirm your rating on the page that opens and optionally add a comment.</p>`,
    bodyText: 'Your request {{ticketNumber}} has been completed. Rate it here: {{trackingUrl}}#satisfaction',
    variables: ['userName', 'ticketNumber', 'subject', 'trackingUrl'],
  },
];

// ==================== ZAMANLANMIŞ GÖREV HATASI (v1.2) ====================
// Bir periyodik görev başarısız olduğunda tüm admin'lere gider. Alıcıya özel
// isim/URL içermez — yöneticiye teknik özet yeterlidir (ayrıntı: Zamanlanmış
// Görevler panelinde çalışma kaydı).
export const JOB_FAILURE_EMAIL_TEMPLATES = [
  {
    slug: 'scheduled_job_failed',
    locale: 'tr',
    subject: 'Zamanlanmış görev başarısız: {{jobKey}}',
    bodyHtml: `<h2>Zamanlanmış Görev Başarısız</h2>
<p><strong>{{jobKey}}</strong> görevi son çalışmasında hata verdi.</p>
<pre style="background:#f5f5f5;padding:12px;border-radius:6px;white-space:pre-wrap;">{{errorMessage}}</pre>
<p>Ayrıntılı çalışma geçmişi için yönetim panelindeki <strong>Zamanlanmış Görevler</strong> sayfasına bakın.</p>`,
    bodyText: 'Zamanlanmış görev başarısız: {{jobKey}}\nHata: {{errorMessage}}\nAyrıntı: Yönetim paneli → Zamanlanmış Görevler.',
    variables: ['jobKey', 'errorMessage'],
  },
  {
    slug: 'scheduled_job_failed',
    locale: 'en',
    subject: 'Scheduled job failed: {{jobKey}}',
    bodyHtml: `<h2>Scheduled Job Failed</h2>
<p>The scheduled job <strong>{{jobKey}}</strong> failed on its last run.</p>
<pre style="background:#f5f5f5;padding:12px;border-radius:6px;white-space:pre-wrap;">{{errorMessage}}</pre>
<p>See the <strong>Scheduled Jobs</strong> page in the admin panel for the run history.</p>`,
    bodyText: 'Scheduled job failed: {{jobKey}}\nError: {{errorMessage}}\nDetails: Admin panel → Scheduled Jobs.',
    variables: ['jobKey', 'errorMessage'],
  },
];

export async function ensureSystemEmailTemplates(prisma: Pick<PrismaClient, 'emailTemplate'>) {
  for (const tmpl of [...SLA_EMAIL_TEMPLATES, ...AUTO_CLOSE_EMAIL_TEMPLATES, ...MERGE_EMAIL_TEMPLATES, ...SURVEY_EMAIL_TEMPLATES, ...JOB_FAILURE_EMAIL_TEMPLATES]) {
    await prisma.emailTemplate.upsert({
      where: { slug_locale: { slug: tmpl.slug, locale: tmpl.locale } },
      update: {},
      create: tmpl,
    });
  }
}
