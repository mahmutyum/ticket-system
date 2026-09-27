-- SLA doğruluğu (v1.1): duraklatma, ihlal öncesi uyarı, mesai takvimi, tatiller.

-- AlterTable
ALTER TABLE "companies" ADD COLUMN "sla_settings" JSONB;

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN "sla_response_warn_at" TIMESTAMP(3),
ADD COLUMN "sla_resolve_warn_at" TIMESTAMP(3),
ADD COLUMN "sla_paused_at" TIMESTAMP(3),
ADD COLUMN "sla_paused_minutes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "company_holidays" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_holidays_company_id_date_key" ON "company_holidays"("company_id", "date");

-- AddForeignKey
ALTER TABLE "company_holidays" ADD CONSTRAINT "company_holidays_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
