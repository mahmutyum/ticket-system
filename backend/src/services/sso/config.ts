import { z } from 'zod';
import { IdentityProviderType, StaffRole } from '@prisma/client';

/**
 * Kimlik sağlayıcı ayarları (`identity_providers.config` JSON) — tür başına şema.
 * Sırlar (client secret, bind parolası) burada DEĞİL, şifreli `secretEnc`'te durur.
 */

const domainList = z.array(z.string().trim().toLowerCase().min(1)).max(20).default([]);

export const oidcConfigSchema = z.object({
  /** Discovery kök adresi (…/.well-known/openid-configuration buna eklenir). */
  issuer: z.string().url(),
  clientId: z.string().min(1).max(300),
  scopes: z.string().max(300).default('openid profile email'),
  /** E-posta claim'i; Entra ID'de çoğunlukla `preferred_username`. */
  emailClaim: z.string().max(100).default('email'),
  nameClaim: z.string().max(100).default('name'),
  /** Grup/rol listesi claim'i (Entra: `groups`/`roles`, Keycloak: `groups`). */
  groupsClaim: z.string().max(100).default('groups'),
  /** Boş değilse yalnızca bu domain'lerdeki e-postalar kabul edilir (çok kiracılı IdP'lerde şart). */
  allowedDomains: domainList,
});

export const samlConfigSchema = z.object({
  /** IdP SSO adresi (HTTP-Redirect binding). */
  entryPoint: z.string().url(),
  /** IdP imza sertifikası (PEM, başlıklı ya da başlıksız). */
  idpCert: z.string().min(20).max(20_000),
  /** Bu uygulamanın SP entity ID'si; boşsa metadata adresi kullanılır. */
  spEntityId: z.string().max(500).optional(),
  emailAttribute: z.string().max(300).default('email'),
  nameAttribute: z.string().max(300).default('displayName'),
  groupsAttribute: z.string().max(300).default('groups'),
  allowedDomains: domainList,
});

export const ldapConfigSchema = z.object({
  /** ldaps://dc.firma.local:636 ya da ldap://…:389 (+ startTls). */
  url: z.string().regex(/^ldaps?:\/\/[^\s/]+(:\d+)?\/?$/i, 'ldap(s)://host[:port]'),
  startTls: z.boolean().default(false),
  /** Sertifika doğrulaması; yalnızca kendi CA'sı olan iç ağlarda kapatılır. */
  tlsRejectUnauthorized: z.boolean().default(true),
  /** Arama için servis hesabı (ör. CN=svc-ticket,OU=Service,DC=firma,DC=local). */
  bindDn: z.string().min(1).max(500),
  baseDn: z.string().min(1).max(500),
  /** `{{username}}` kaçışlanarak yerleştirilir. AD: (&(objectClass=user)(sAMAccountName={{username}})) */
  userFilter: z.string().max(500).default('(&(objectClass=user)(sAMAccountName={{username}}))'),
  emailAttribute: z.string().max(100).default('mail'),
  nameAttribute: z.string().max(100).default('displayName'),
  groupsAttribute: z.string().max(100).default('memberOf'),
  allowedDomains: domainList,
});

export type OidcConfig = z.infer<typeof oidcConfigSchema>;
export type SamlConfig = z.infer<typeof samlConfigSchema>;
export type LdapConfig = z.infer<typeof ldapConfigSchema>;

export const roleMappingSchema = z.array(
  z.object({ group: z.string().trim().min(1).max(500), role: z.nativeEnum(StaffRole) }),
).max(50);
export const companyMappingSchema = z.array(
  z.object({ group: z.string().trim().min(1).max(500), companyId: z.string().min(1).max(128) }),
).max(200);

export type RoleMapping = z.infer<typeof roleMappingSchema>[number];
export type CompanyMapping = z.infer<typeof companyMappingSchema>[number];

export function configSchemaFor(type: IdentityProviderType) {
  switch (type) {
    case IdentityProviderType.oidc: return oidcConfigSchema;
    case IdentityProviderType.saml: return samlConfigSchema;
    case IdentityProviderType.ldap: return ldapConfigSchema;
  }
}

/** Kayıttaki JSON'u tür şemasıyla okur; bozuksa hata fırlatır (giriş denenmez). */
export function parseProviderConfig<T extends IdentityProviderType>(type: T, raw: unknown) {
  return configSchemaFor(type).parse(raw) as T extends 'oidc' ? OidcConfig : T extends 'saml' ? SamlConfig : LdapConfig;
}

/** Sistem ayarı `auth` */
export const authSettingsSchema = z.object({
  /** Yerel parola girişi kapalı mı? Admin hesapları acil durum için her zaman girebilir. */
  localLoginDisabled: z.boolean().default(false),
});
export type AuthSettings = z.infer<typeof authSettingsSchema>;
