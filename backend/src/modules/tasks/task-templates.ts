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
      locale: 'tr',
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
      slug: 'task_assigned',
      locale: 'en',
      subject: 'New Task Assigned — {{taskTitle}}',
      bodyHtml: `<h2>A New Task Was Assigned to You</h2>
<p>Dear {{staffName}},</p>
<p><strong>{{createdBy}}</strong> assigned you a new task:</p>
<table style="border-collapse:collapse;margin:12px 0;">
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Title:</td><td><strong>{{taskTitle}}</strong></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Priority:</td><td>{{priority}}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Due Date:</td><td>{{dueDate}}</td></tr>
</table>
<blockquote style="border-left:3px solid #2563eb;padding-left:12px;color:#444;">{{taskDescription}}</blockquote>
<p><a href="{{taskUrl}}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">View Task</a></p>`,
      bodyText: 'New task assigned: {{taskTitle}} (Priority: {{priority}}, Due: {{dueDate}}). Details: {{taskUrl}}',
      variables: ['staffName', 'taskTitle', 'taskDescription', 'priority', 'dueDate', 'createdBy', 'taskUrl'],
    },
    {
      slug: 'task_completed',
      locale: 'tr',
      subject: 'Görev Tamamlandı — {{taskTitle}}',
      bodyHtml: `<h2>Görev Tamamlandı</h2>
<p>Oluşturduğunuz <strong>{{taskTitle}}</strong> görevi <strong>{{completedBy}}</strong> tarafından tamamlandı olarak işaretlendi.</p>
<p><a href="{{taskUrl}}">Görevi Görüntüle</a></p>`,
      bodyText: 'Görev tamamlandı: {{taskTitle}} ({{completedBy}}). Detay: {{taskUrl}}',
      variables: ['taskTitle', 'completedBy', 'taskUrl'],
    },
    {
      slug: 'task_completed',
      locale: 'en',
      subject: 'Task Completed — {{taskTitle}}',
      bodyHtml: `<h2>Task Completed</h2>
<p>The task <strong>{{taskTitle}}</strong> you created was marked as completed by <strong>{{completedBy}}</strong>.</p>
<p><a href="{{taskUrl}}">View Task</a></p>`,
      bodyText: 'Task completed: {{taskTitle}} ({{completedBy}}). Details: {{taskUrl}}',
      variables: ['taskTitle', 'completedBy', 'taskUrl'],
    },
  ];

  for (const tmpl of templates) {
    await prisma.emailTemplate.upsert({
      where: { slug_locale: { slug: tmpl.slug, locale: tmpl.locale } },
      update: {},
      create: tmpl,
    });
  }
}
