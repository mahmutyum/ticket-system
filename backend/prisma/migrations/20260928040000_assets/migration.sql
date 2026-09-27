-- Varlık (envanter) kaydı ve ticket bağlantısı (v1.1).

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "asset_id" TEXT;

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "asset_type" TEXT NOT NULL,
    "serial_number" TEXT,
    "location_id" TEXT,
    "assigned_to_email" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assets_company_id_assigned_to_email_idx" ON "assets"("company_id", "assigned_to_email");

-- CreateIndex
CREATE UNIQUE INDEX "assets_company_id_tag_key" ON "assets"("company_id", "tag");

-- CreateIndex
CREATE INDEX "tickets_asset_id_idx" ON "tickets"("asset_id");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

