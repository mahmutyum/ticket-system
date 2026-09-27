-- Personel SSO (v1.1): OIDC / SAML / LDAP kimlik sağlayıcıları, hesap bağlama, sistem ayarları.

-- CreateEnum
CREATE TYPE "IdentityProviderType" AS ENUM ('oidc', 'saml', 'ldap');

-- AlterTable
ALTER TABLE "staff" ADD COLUMN     "external_subject" TEXT,
ADD COLUMN     "identity_provider_id" TEXT;

-- CreateTable
CREATE TABLE "identity_providers" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "IdentityProviderType" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secret_enc" TEXT,
    "jit_provisioning" BOOLEAN NOT NULL DEFAULT false,
    "role_mappings" JSONB NOT NULL DEFAULT '[]',
    "company_mappings" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identity_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "identity_providers_slug_key" ON "identity_providers"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "staff_identity_provider_id_external_subject_key" ON "staff"("identity_provider_id", "external_subject");

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_identity_provider_id_fkey" FOREIGN KEY ("identity_provider_id") REFERENCES "identity_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

