-- Ticket ilişkileri (v1.1): üst/alt, birleştirme, izleyiciler (CC).

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "merged_into_id" TEXT,
ADD COLUMN     "parent_id" TEXT;

-- CreateTable
CREATE TABLE "ticket_watchers" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "staff_id" TEXT,
    "added_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_watchers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_watchers_email_idx" ON "ticket_watchers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_watchers_ticket_id_email_key" ON "ticket_watchers"("ticket_id", "email");

-- CreateIndex
CREATE INDEX "tickets_parent_id_idx" ON "tickets"("parent_id");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_watchers" ADD CONSTRAINT "ticket_watchers_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_watchers" ADD CONSTRAINT "ticket_watchers_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

