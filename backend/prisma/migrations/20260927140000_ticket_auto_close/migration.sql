-- Otomatik kapatma (v1.1): son durum değişikliği anı + bekleme hatırlatması.

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN "status_changed_at" TIMESTAMP(3),
ADD COLUMN "auto_close_reminder_at" TIMESTAMP(3);

-- Mevcut ticket'lar için son durum değişikliği: geçmişteki son `status_changed`
-- kaydı; hiç yoksa oluşturulma anı. Böylece migration sonrası ilk turda yıllardır
-- "çözüldü"de bekleyen ticket'lar doğru yaşla değerlendirilir.
UPDATE "tickets" t
SET "status_changed_at" = COALESCE(
  (SELECT MAX(h."created_at") FROM "ticket_history" h
    WHERE h."ticket_id" = t."id" AND h."action" = 'status_changed'),
  t."created_at"
);

-- CreateIndex
CREATE INDEX "tickets_status_status_changed_at_idx" ON "tickets"("status", "status_changed_at");
