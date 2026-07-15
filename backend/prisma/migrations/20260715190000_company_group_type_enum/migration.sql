-- Company.groupType'ı enum'a çevir.
--
-- Neden şimdiye kadar String kaldı: yazma yolu `z.string().min(1)` ile
-- doğrulanıyordu, yani veritabanında listenin dışında değerler bulunabilirdi ve
-- doğrudan `ALTER ... USING` patlardı. Yazma yolu artık z.nativeEnum ile
-- kısıtlanıyor; bu migration mevcut veriyi de temizler.
--
-- ÖNCE ÇALIŞTIR — beklenmedik değerleri gör:
--   SELECT DISTINCT group_type, count(*) FROM companies
--     WHERE group_type NOT IN ('call_center','corporate','warehouse','retail')
--     GROUP BY group_type;
--
-- Aşağıdaki UPDATE, tanınmayan değerleri 'corporate'a çeker (en genel kategori).
-- Bu bir VERİ KAYBIDIR: eski etiket kaybolur. Yukarıdaki sorguyu çalıştırıp
-- çıktısını saklamadan geçme — özel bir eşleme gerekiyorsa bu migration'dan
-- ÖNCE elle UPDATE yaz.
CREATE TYPE "CompanyGroupType" AS ENUM ('call_center', 'corporate', 'warehouse', 'retail');

UPDATE "companies"
SET "group_type" = 'corporate'
WHERE "group_type" NOT IN ('call_center', 'corporate', 'warehouse', 'retail');

ALTER TABLE "companies"
  ALTER COLUMN "group_type" TYPE "CompanyGroupType" USING "group_type"::text::"CompanyGroupType";
