-- Otomatik kapatma (v1.1): son durum değişikliği anı + bekleme hatırlatması.

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN "status_changed_at" TIMESTAMP(3),
ADD COLUMN "auto_close_reminder_at" TIMESTAMP(3);

-- Mevcut ticket'lar için son durum değişikliği: geçmişteki son `status_changed`
-- kaydı; hiç yoksa oluşturulma anı.
UPDATE "tickets" t
SET "status_changed_at" = COALESCE(
  (SELECT MAX(h."created_at") FROM "ticket_history" h
    WHERE h."ticket_id" = t."id" AND h."action" = 'status_changed'),
  t."created_at"
);

-- Yükseltme anında zaten "çözüldü" / "yanıt bekleniyor" olan ticket'ların otomatik
-- kapatma sayacı ŞİMDİ başlar: aksi hâlde ilk turda birikmiş tüm eski ticket'lar
-- topluca kapanır ve talep sahiplerine toplu e-posta giderdi. Yönetici bu sürede
-- şirket bazlı süreleri ayarlayabilir (0 = kapalı).
UPDATE "tickets" SET "status_changed_at" = CURRENT_TIMESTAMP
WHERE "status" IN ('resolved', 'waiting_user_response');

-- CreateIndex
CREATE INDEX "tickets_status_status_changed_at_idx" ON "tickets"("status", "status_changed_at");
