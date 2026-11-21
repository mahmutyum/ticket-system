-- Şema-migration örtüşme düzeltmesi (v1.3.2, Prisma 7 drift denetimi)
--
-- TicketTemplate tablosu "task_templates" iken bir migration ile
-- "ticket_templates" olarak yeniden adlandırıldı; Postgres tablo yeniden
-- adlandırmada FK kısıt adını DEĞİŞTİRMEZ. Migration zincirinden kurulan taze
-- veritabanlarında kısıt eski adını taşır; schema.prisma ise yeni adı bekler
-- (task_templates_priority_fkey → ticket_templates_priority_fkey). Prisma 7'nin
-- `migrate diff` denetimi bu farkı raporlar — gerçek bir yeniden adlandırma
-- migration'ı ile kısıt adı şemaya hizalanır. Yalnızca metadata; veri dokunulmaz.
ALTER TABLE "ticket_templates" RENAME CONSTRAINT "task_templates_priority_fkey" TO "ticket_templates_priority_fkey";
