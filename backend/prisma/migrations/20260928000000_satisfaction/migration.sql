-- Memnuniyet anketi (CSAT, v1.1).

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "satisfaction_at" TIMESTAMP(3),
ADD COLUMN     "satisfaction_comment" TEXT,
ADD COLUMN     "satisfaction_rating" INTEGER,
ADD COLUMN     "survey_sent_at" TIMESTAMP(3);


-- Puan aralığı veritabanında da korunur.
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_satisfaction_rating_range" CHECK ("satisfaction_rating" IS NULL OR "satisfaction_rating" BETWEEN 1 AND 5);
