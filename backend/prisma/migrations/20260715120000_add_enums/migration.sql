-- Durum / öncelik / rol alanlarını String'den Postgres enum'una çevir.
--
-- Bu değerlerin geçerli kümesi yalnızca Zod şemalarında yaşıyordu: veritabanı
-- seviyesinde hiçbir koruma yoktu. Artık DB de zorluyor.
--
-- GÜVENLİK NOTU — bu migration BİLEREK fail-loud'dur:
-- Bir kolonda enum'a ait olmayan bir değer varsa `ALTER ... USING` hata verir ve
-- migration durur. Bu istenen davranıştır; sessizce yanlış bir değere eşlemektense
-- durup veriyi incelemek doğrudur.
--
-- ÖNCE ÇALIŞTIR (hepsi 0 satır dönmeli):
--   SELECT DISTINCT role FROM staff
--     WHERE role NOT IN ('admin','it_manager','it_staff');
--   SELECT DISTINCT status FROM tickets
--     WHERE status NOT IN ('open','in_progress','waiting_user_response',
--       'waiting_other_department','topic_transferred','process_outside_it',
--       'on_hold','resolved','closed');
--   SELECT DISTINCT priority FROM tickets  WHERE priority NOT IN ('low','medium','high','critical');
--   SELECT DISTINCT priority FROM tasks    WHERE priority NOT IN ('low','medium','high','critical');
--   SELECT DISTINCT status   FROM tasks    WHERE status   NOT IN ('open','in_progress','done','cancelled');
--   SELECT DISTINCT field_type FROM custom_fields
--     WHERE field_type NOT IN ('text','number','select','phone','url','email','textarea');
--   SELECT DISTINCT type   FROM onsite_support WHERE type   NOT IN ('come_to_it_room','meeting_room','visit_employee');
--   SELECT DISTINCT status FROM onsite_support WHERE status NOT IN ('scheduled','in_progress','completed','cancelled');
--   SELECT DISTINCT type   FROM notifications  WHERE type   NOT IN ('email','sms');
--   SELECT DISTINCT status FROM notifications  WHERE status NOT IN ('pending','sent','failed');
--   SELECT DISTINCT priority FROM ticket_templates WHERE priority NOT IN ('low','medium','high','critical');
--
-- Beklenmedik değer çıkarsa önce onu düzelt (UPDATE), sonra bu migration'ı çalıştır.
-- Görevlerdeki 'urgent' değeri bir önceki migration'da zaten 'critical'a çevrildi.
--
-- Her kolonda sıra önemlidir: default DROP edilmeden tip değiştirilemez,
-- çünkü eski default (text) yeni tiple uyumsuzdur.

-- ==================== TYPE'LAR ====================

CREATE TYPE "StaffRole" AS ENUM ('admin', 'it_manager', 'it_staff');

CREATE TYPE "TicketStatus" AS ENUM (
  'open', 'in_progress', 'waiting_user_response', 'waiting_other_department',
  'topic_transferred', 'process_outside_it', 'on_hold', 'resolved', 'closed'
);

CREATE TYPE "Priority" AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TYPE "TaskStatus" AS ENUM ('open', 'in_progress', 'done', 'cancelled');

CREATE TYPE "OnsiteType" AS ENUM ('come_to_it_room', 'meeting_room', 'visit_employee');

CREATE TYPE "OnsiteStatus" AS ENUM ('scheduled', 'in_progress', 'completed', 'cancelled');

CREATE TYPE "NotificationType" AS ENUM ('email', 'sms');

CREATE TYPE "NotificationStatus" AS ENUM ('pending', 'sent', 'failed');

CREATE TYPE "CustomFieldType" AS ENUM ('text', 'number', 'select', 'phone', 'url', 'email', 'textarea');

-- ==================== staff.role ====================
-- Default yok — doğrudan çevrilir.
ALTER TABLE "staff"
  ALTER COLUMN "role" TYPE "StaffRole" USING "role"::text::"StaffRole";

-- ==================== tickets.status / tickets.priority ====================
ALTER TABLE "tickets" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "tickets"
  ALTER COLUMN "status" TYPE "TicketStatus" USING "status"::text::"TicketStatus";
ALTER TABLE "tickets" ALTER COLUMN "status" SET DEFAULT 'open';

ALTER TABLE "tickets" ALTER COLUMN "priority" DROP DEFAULT;
ALTER TABLE "tickets"
  ALTER COLUMN "priority" TYPE "Priority" USING "priority"::text::"Priority";
ALTER TABLE "tickets" ALTER COLUMN "priority" SET DEFAULT 'medium';

-- ==================== tasks.status / tasks.priority ====================
ALTER TABLE "tasks" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "tasks"
  ALTER COLUMN "status" TYPE "TaskStatus" USING "status"::text::"TaskStatus";
ALTER TABLE "tasks" ALTER COLUMN "status" SET DEFAULT 'open';

ALTER TABLE "tasks" ALTER COLUMN "priority" DROP DEFAULT;
ALTER TABLE "tasks"
  ALTER COLUMN "priority" TYPE "Priority" USING "priority"::text::"Priority";
ALTER TABLE "tasks" ALTER COLUMN "priority" SET DEFAULT 'medium';

-- ==================== ticket_templates.priority ====================
ALTER TABLE "ticket_templates" ALTER COLUMN "priority" DROP DEFAULT;
ALTER TABLE "ticket_templates"
  ALTER COLUMN "priority" TYPE "Priority" USING "priority"::text::"Priority";
ALTER TABLE "ticket_templates" ALTER COLUMN "priority" SET DEFAULT 'medium';

-- ==================== custom_fields.field_type ====================
ALTER TABLE "custom_fields"
  ALTER COLUMN "field_type" TYPE "CustomFieldType" USING "field_type"::text::"CustomFieldType";

-- ==================== onsite_support.type / status ====================
ALTER TABLE "onsite_support"
  ALTER COLUMN "type" TYPE "OnsiteType" USING "type"::text::"OnsiteType";

ALTER TABLE "onsite_support" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "onsite_support"
  ALTER COLUMN "status" TYPE "OnsiteStatus" USING "status"::text::"OnsiteStatus";
ALTER TABLE "onsite_support" ALTER COLUMN "status" SET DEFAULT 'scheduled';

-- ==================== notifications.type / status ====================
ALTER TABLE "notifications"
  ALTER COLUMN "type" TYPE "NotificationType" USING "type"::text::"NotificationType";

ALTER TABLE "notifications" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "notifications"
  ALTER COLUMN "status" TYPE "NotificationStatus" USING "status"::text::"NotificationStatus";
ALTER TABLE "notifications" ALTER COLUMN "status" SET DEFAULT 'pending';
