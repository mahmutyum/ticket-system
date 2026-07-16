-- Bildirim dili (TR/EN) desteği.
--
-- E-posta/SMS şablonları artık her dil için ayrı satır tutar: aynı `slug` hem
-- 'tr' hem 'en' locale ile bulunabilir. Worker, alıcının diline göre şablon seçer;
-- o dil yoksa 'tr'ye düşer.
--
-- Alıcının dili:
--   - personel  → `staff.locale`
--   - talep eden → `tickets.locale` (talep oluştururken yakalanır)
-- Her ikisi de eski kayıtlarda varsayılan olarak 'tr'dir; davranış değişmez.

-- Alıcı dili sütunları.
ALTER TABLE "staff" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'tr';
ALTER TABLE "tickets" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'tr';

-- Şablon dili sütunları.
ALTER TABLE "email_templates" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'tr';
ALTER TABLE "sms_templates" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'tr';

-- Benzersizlik slug'dan (slug, locale)'e taşınır.
DROP INDEX "email_templates_slug_key";
DROP INDEX "sms_templates_slug_key";

CREATE UNIQUE INDEX "email_templates_slug_locale_key" ON "email_templates"("slug", "locale");
CREATE UNIQUE INDEX "sms_templates_slug_locale_key" ON "sms_templates"("slug", "locale");
