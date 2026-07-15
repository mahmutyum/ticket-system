-- Public takip token'ına geçerlilik sonu ekle.
--
-- accessToken süresiz, döndürülemez ve ticket kapandığında iptal edilemezdi.
-- URL YOLUNDA taşındığı için nginx access_log'una tam olarak yazılır ve
-- e-postalarda/tarayıcı geçmişinde kalır: tek bir log satırı o ticket'a KALICI
-- erişim demekti.
--
-- Ticket açıkken null (süresiz) — talep eden süreç boyunca erişebilmeli.
-- Kapanışta uygulama katmanı kapanış + saklama süresi olarak set eder.
--
-- Mevcut KAPALI ticket'lara da bir son verilir: aksi halde eski linkler sonsuza
-- dek geçerli kalırdı. Kapanış tarihi bilinenler için o tarih, bilinmeyenler
-- için güncelleme tarihi esas alınır.
ALTER TABLE "tickets" ADD COLUMN "access_token_expires_at" TIMESTAMP(3);

UPDATE "tickets"
SET "access_token_expires_at" = COALESCE("closed_at", "resolved_at", "updated_at") + INTERVAL '90 days'
WHERE "status" IN ('resolved', 'closed');
