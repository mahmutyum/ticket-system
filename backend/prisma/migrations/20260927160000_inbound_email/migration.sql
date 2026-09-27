-- E-postayla yanıt (v1.1): şirket posta kutusu, işlenen mesaj kaydı, ticket kaynağı.

-- CreateEnum
CREATE TYPE "MailboxProvider" AS ENUM ('imap', 'microsoft365', 'gmail');

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'portal';

-- CreateTable
CREATE TABLE "company_mailboxes" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "provider" "MailboxProvider" NOT NULL,
    "address" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "imap_host" TEXT,
    "imap_port" INTEGER,
    "imap_secure" BOOLEAN NOT NULL DEFAULT true,
    "username" TEXT,
    "tenant_id" TEXT,
    "client_id" TEXT,
    "secret_enc" TEXT,
    "refresh_token_enc" TEXT,
    "create_tickets" BOOLEAN NOT NULL DEFAULT false,
    "default_category_id" TEXT,
    "default_location_id" TEXT,
    "default_locale" TEXT NOT NULL DEFAULT 'tr',
    "last_fetch_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_mailboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_messages" (
    "id" TEXT NOT NULL,
    "mailbox_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "from_email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "ticket_id" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_mailboxes_company_id_key" ON "company_mailboxes"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_mailboxes_address_key" ON "company_mailboxes"("address");

-- CreateIndex
CREATE INDEX "inbound_messages_mailbox_id_received_at_idx" ON "inbound_messages"("mailbox_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_messages_mailbox_id_message_id_key" ON "inbound_messages"("mailbox_id", "message_id");

-- AddForeignKey
ALTER TABLE "company_mailboxes" ADD CONSTRAINT "company_mailboxes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "company_mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

