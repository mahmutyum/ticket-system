-- Bilgi bankası (v1.1).

-- CreateTable
CREATE TABLE "kb_articles" (
    "id" TEXT NOT NULL,
    "company_id" TEXT,
    "category_id" TEXT,
    "title_tr" TEXT NOT NULL,
    "body_tr" TEXT NOT NULL,
    "title_en" TEXT,
    "body_en" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "helpful_yes" INTEGER NOT NULL DEFAULT 0,
    "helpful_no" INTEGER NOT NULL DEFAULT 0,
    "deflections" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kb_articles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kb_articles_company_id_is_published_idx" ON "kb_articles"("company_id", "is_published");

-- CreateIndex
CREATE INDEX "kb_articles_category_id_idx" ON "kb_articles"("category_id");

-- AddForeignKey
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

