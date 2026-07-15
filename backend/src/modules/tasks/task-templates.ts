import { PrismaClient } from '@prisma/client';

/**
 * Görev modülü için gerekli email template'lerini garanti eder.
 * App startup'ında çağrılır (db push sonrası). İçerik değişirse update etmez —
 * yalnızca yoksa oluşturur. Template editörü üzerinden manuel düzenleme yapılabilir.
 */
export async function ensureTaskEmailTemplates(prisma: PrismaClient) {
  const templates = [
    {
      slug: 'task_assigned',
      subject: 'Yeni Görev Atandı — {{taskTitle}}',
      bodyHtml: `<h2>Size Yeni Bir Görev Atandı</h2>
<p>Sayın {{staffName}},</p>
<p><strong>{{createdBy}}</strong> tarafından size yeni bir görev atandı:</p>
<table style="border-collapse:collapse;margin:12px 0;">
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Başlık:</td><td><strong>{{taskTitle}}</strong></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Öncelik:</td><td>{{priority}}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Bitiş Tarihi:</td><td>{{dueDate}}</td></tr>
</table>
<blockquote style="border-left:3px solid #2563eb;padding-left:12px;color:#444;">{{taskDescription}}</blockquote>
<p><a href="{{taskUrl}}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">Görevi Görüntüle</a></p>`,
      bodyText: 'Yeni görev atandı: {{taskTitle}} (Öncelik: {{priority}}, Bitiş: {{dueDate}}). Detay: {{taskUrl}}',
      variables: ['staffName', 'taskTitle', 'taskDescription', 'priority', 'dueDate', 'createdBy', 'taskUrl'],
    },
    {
      slug: 'task_completed',
      subject: 'Görev Tamamlandı — {{taskTitle}}',
      bodyHtml: `<h2>Görev Tamamlandı</h2>
<p>Oluşturduğunuz <strong>{{taskTitle}}</strong> görevi <strong>{{completedBy}}</strong> tarafından tamamlandı olarak işaretlendi.</p>
<p><a href="{{taskUrl}}">Görevi Görüntüle</a></p>`,
      bodyText: 'Görev tamamlandı: {{taskTitle}} ({{completedBy}}). Detay: {{taskUrl}}',
      variables: ['taskTitle', 'completedBy', 'taskUrl'],
    },
  ];

  for (const tmpl of templates) {
    await prisma.emailTemplate.upsert({
      where: { slug: tmpl.slug },
      update: {},
      create: tmpl,
    });
  }
}
