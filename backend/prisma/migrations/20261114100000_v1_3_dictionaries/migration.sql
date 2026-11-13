-- v1.3 — DB'den yönetilen sözlükler
--
-- Şirket türü, ticket durumu/önceliği, görev durumu, yerinde destek türü/durumu
-- Prisma enum'undan sözlük tablolarına taşınır. Veri kayıpsızdır: mevcut
-- enum değerleri `key` olarak sözlüklere isSystem satırı olarak eklenir,
-- kolonlar TEXT'e çevrilip sözlük key'ine FK ile bağlanır.
--
-- Davranış anahtara değil SINIFA bağlanır: dict_ticket_statuses.status_class
-- (new/active/waiting/resolved/closed) — SLA duraklatma 'waiting' sınıfına,
-- otomatik kapatma 'resolved' sınıfına bakar. StatusClass kodda kalır
-- (panelden eklenemez, davranış sözleşmesidir).

-- 1) Davranış sınıfı enum'u
CREATE TYPE "StatusClass" AS ENUM ('new', 'active', 'waiting', 'resolved', 'closed');

-- 2) Sözlük tabloları
CREATE TABLE "dict_ticket_statuses" (
    "key" TEXT NOT NULL,
    "label_tr" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "color" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status_class" "StatusClass" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dict_ticket_statuses_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "dict_priorities" (
    "key" TEXT NOT NULL,
    "label_tr" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "color" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 2,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dict_priorities_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "dict_task_statuses" (
    "key" TEXT NOT NULL,
    "label_tr" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "color" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dict_task_statuses_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "dict_onsite_types" (
    "key" TEXT NOT NULL,
    "label_tr" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dict_onsite_types_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "dict_onsite_statuses" (
    "key" TEXT NOT NULL,
    "label_tr" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "color" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dict_onsite_statuses_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "dict_company_types" (
    "key" TEXT NOT NULL,
    "label_tr" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "color" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dict_company_types_pkey" PRIMARY KEY ("key")
);

-- 3) Sistem sözlük satırları — mevcut enum değerlerinin karşılıkları (AYNI key'ler)
INSERT INTO "dict_ticket_statuses" ("key", "label_tr", "label_en", "color", "sort_order", "status_class", "is_system", "created_at", "updated_at") VALUES
  ('open', 'Açık', 'Open', 'blue', 1, 'new', true, now(), now()),
  ('in_progress', 'İşlemde', 'In progress', 'yellow', 2, 'active', true, now(), now()),
  ('waiting_user_response', 'Kullanıcı Yanıtı Bekleniyor', 'Awaiting user response', 'purple', 3, 'waiting', true, now(), now()),
  ('waiting_other_department', 'Diğer Birimden Destek Bekleniyor', 'Awaiting support from another department', 'orange', 4, 'waiting', true, now(), now()),
  ('topic_transferred', 'Konu Aktarıldı', 'Topic transferred', 'indigo', 5, 'active', true, now(), now()),
  ('process_outside_it', 'Süreç IT Dışında İlerliyor', 'Process progressing outside IT', 'gray', 6, 'waiting', true, now(), now()),
  ('on_hold', 'Beklemede', 'On hold', 'gray', 7, 'waiting', true, now(), now()),
  ('resolved', 'Çözüldü', 'Resolved', 'green', 8, 'resolved', true, now(), now()),
  ('closed', 'Kapatıldı', 'Closed', 'gray', 9, 'closed', true, now(), now());

INSERT INTO "dict_priorities" ("key", "label_tr", "label_en", "color", "weight", "sort_order", "is_system", "created_at", "updated_at") VALUES
  ('low', 'Düşük', 'Low', 'gray', 1, 1, true, now(), now()),
  ('medium', 'Orta', 'Medium', 'blue', 2, 2, true, now(), now()),
  ('high', 'Yüksek', 'High', 'orange', 3, 3, true, now(), now()),
  ('critical', 'Kritik', 'Critical', 'red', 4, 4, true, now(), now());

INSERT INTO "dict_task_statuses" ("key", "label_tr", "label_en", "color", "sort_order", "is_system", "created_at", "updated_at") VALUES
  ('open', 'Açık', 'Open', 'blue', 1, true, now(), now()),
  ('in_progress', 'Devam Ediyor', 'In progress', 'yellow', 2, true, now(), now()),
  ('done', 'Tamamlandı', 'Done', 'green', 3, true, now(), now()),
  ('cancelled', 'İptal', 'Cancelled', 'red', 4, true, now(), now());

INSERT INTO "dict_onsite_types" ("key", "label_tr", "label_en", "sort_order", "is_system", "created_at", "updated_at") VALUES
  ('come_to_it_room', 'IT Odasına Gelin', 'Come to the IT room', 1, true, now(), now()),
  ('meeting_room', 'Toplantı Odası', 'Meeting room', 2, true, now(), now()),
  ('visit_employee', 'Yerinde Müdahale', 'Onsite intervention', 3, true, now(), now());

INSERT INTO "dict_onsite_statuses" ("key", "label_tr", "label_en", "color", "sort_order", "is_system", "created_at", "updated_at") VALUES
  ('scheduled', 'Planlanmış', 'Scheduled', 'blue', 1, true, now(), now()),
  ('in_progress', 'Devam Ediyor', 'In progress', 'yellow', 2, true, now(), now()),
  ('completed', 'Tamamlandı', 'Completed', 'green', 3, true, now(), now()),
  ('cancelled', 'İptal', 'Cancelled', 'red', 4, true, now(), now());

INSERT INTO "dict_company_types" ("key", "label_tr", "label_en", "color", "sort_order", "is_system", "created_at", "updated_at") VALUES
  ('call_center', 'Çağrı Merkezi', 'Call center', 'blue', 1, true, now(), now()),
  ('corporate', 'Kurumsal', 'Corporate', 'indigo', 2, true, now(), now()),
  ('warehouse', 'Depo', 'Warehouse', 'gray', 3, true, now(), now()),
  ('retail', 'Perakende', 'Retail', 'orange', 4, true, now(), now());

-- 4) Kolon dönüşümleri — enum → TEXT (USING cast; kayıpsız)
ALTER TABLE "companies" ALTER COLUMN "group_type" SET DATA TYPE TEXT USING "group_type"::text;
ALTER TABLE "tickets" ALTER COLUMN "priority" SET DATA TYPE TEXT USING "priority"::text;
ALTER TABLE "tickets" ALTER COLUMN "status" SET DATA TYPE TEXT USING "status"::text;
ALTER TABLE "ticket_templates" ALTER COLUMN "priority" SET DATA TYPE TEXT USING "priority"::text;
ALTER TABLE "tasks" ALTER COLUMN "priority" SET DATA TYPE TEXT USING "priority"::text;
ALTER TABLE "tasks" ALTER COLUMN "status" SET DATA TYPE TEXT USING "status"::text;
ALTER TABLE "onsite_support" ALTER COLUMN "type" SET DATA TYPE TEXT USING "type"::text;
ALTER TABLE "onsite_support" ALTER COLUMN "status" SET DATA TYPE TEXT USING "status"::text;

-- 5) Varsayılanlar (sözlük satırları yukarıda eklendi — FK ile uyumlu)
ALTER TABLE "tickets" ALTER COLUMN "priority" SET DEFAULT 'medium';
ALTER TABLE "tickets" ALTER COLUMN "status" SET DEFAULT 'open';
ALTER TABLE "ticket_templates" ALTER COLUMN "priority" SET DEFAULT 'medium';
ALTER TABLE "tasks" ALTER COLUMN "priority" SET DEFAULT 'medium';
ALTER TABLE "tasks" ALTER COLUMN "status" SET DEFAULT 'open';
ALTER TABLE "onsite_support" ALTER COLUMN "status" SET DEFAULT 'scheduled';

-- 6) FK'lar — silme RESTRICT: kullanımdaki sözlük anahtarı silinemez (pasifleştirilir)
ALTER TABLE "companies" ADD CONSTRAINT "companies_group_type_fkey" FOREIGN KEY ("group_type") REFERENCES "dict_company_types"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_status_fkey" FOREIGN KEY ("status") REFERENCES "dict_ticket_statuses"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_priority_fkey" FOREIGN KEY ("priority") REFERENCES "dict_priorities"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ticket_templates" ADD CONSTRAINT "task_templates_priority_fkey" FOREIGN KEY ("priority") REFERENCES "dict_priorities"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_priority_fkey" FOREIGN KEY ("priority") REFERENCES "dict_priorities"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_fkey" FOREIGN KEY ("status") REFERENCES "dict_task_statuses"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "onsite_support" ADD CONSTRAINT "onsite_support_type_fkey" FOREIGN KEY ("type") REFERENCES "dict_onsite_types"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "onsite_support" ADD CONSTRAINT "onsite_support_status_fkey" FOREIGN KEY ("status") REFERENCES "dict_onsite_statuses"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 7) Eski enum türlerini düşür
DROP TYPE "TicketStatus";
DROP TYPE "Priority";
DROP TYPE "TaskStatus";
DROP TYPE "OnsiteType";
DROP TYPE "OnsiteStatus";
DROP TYPE "CompanyGroupType";
