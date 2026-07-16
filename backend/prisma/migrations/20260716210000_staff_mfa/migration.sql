ALTER TABLE "staff"
  ADD COLUMN "mfa_secret_enc" TEXT,
  ADD COLUMN "mfa_enabled" BOOLEAN NOT NULL DEFAULT false;
