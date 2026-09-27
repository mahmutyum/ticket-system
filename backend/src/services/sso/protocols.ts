import * as oidc from 'openid-client';
import { SAML, ValidateInResponseTo, type CacheProvider, type Profile } from '@node-saml/node-saml';
import { Client as LdapClient, Filter } from 'ldapts';
import type Redis from 'ioredis';
import type { LdapConfig, OidcConfig, SamlConfig } from './config.js';
import type { SsoIdentity } from './resolve.js';

/**
 * Protokol adaptörleri — her biri sağlayıcıdan gelen yanıtı ortak `SsoIdentity`'ye çevirir.
 * Hesap eşleme / yetki kararları burada DEĞİL, `resolve.ts`'tedir.
 */

/** Claim/attribute değerini dizi olarak okur (tek değer, dizi ya da yok). */
export function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string' && value) return [value];
  return [];
}

const firstString = (value: unknown): string => asList(value)[0] ?? '';

// ==================== OIDC ====================

const oidcCache = new Map<string, { config: oidc.Configuration; at: number }>();
const OIDC_CACHE_MS = 60 * 60 * 1000;

/** Discovery sonucu sağlayıcı sürümüne (updatedAt) göre 1 saat önbelleklenir. */
export async function oidcConfiguration(cacheKey: string, cfg: OidcConfig, clientSecret: string): Promise<oidc.Configuration> {
  const hit = oidcCache.get(cacheKey);
  if (hit && Date.now() - hit.at < OIDC_CACHE_MS) return hit.config;
  const issuer = new URL(cfg.issuer);
  // openid-client yalnızca HTTPS'e izin verir. Düz HTTP yalnızca production DIŞINDA
  // (yerel Keycloak / test sunucusu) kabul edilir; production'da token'lar ağda açık gitmez.
  const insecure = issuer.protocol === 'http:' && process.env.NODE_ENV !== 'production';
  const config = await oidc.discovery(issuer, cfg.clientId, clientSecret, undefined, insecure ? { execute: [oidc.allowInsecureRequests] } : undefined);
  oidcCache.set(cacheKey, { config, at: Date.now() });
  return config;
}

export interface OidcChecks {
  codeVerifier: string;
  state: string;
  nonce: string;
}

export async function oidcAuthorizationUrl(
  config: oidc.Configuration,
  cfg: OidcConfig,
  redirectUri: string,
): Promise<{ url: string; checks: OidcChecks }> {
  const checks = { codeVerifier: oidc.randomPKCECodeVerifier(), state: oidc.randomState(), nonce: oidc.randomNonce() };
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: cfg.scopes,
    code_challenge: await oidc.calculatePKCECodeChallenge(checks.codeVerifier),
    code_challenge_method: 'S256',
    state: checks.state,
    nonce: checks.nonce,
  });
  return { url: url.href, checks };
}

/** Kodu token'a çevirir; imza, iss/aud/exp, state, nonce ve PKCE kütüphane tarafından doğrulanır. */
export async function oidcCallback(
  config: oidc.Configuration,
  cfg: OidcConfig,
  currentUrl: URL,
  checks: OidcChecks,
): Promise<SsoIdentity> {
  const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: checks.codeVerifier,
    expectedState: checks.state,
    expectedNonce: checks.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims() as Record<string, unknown> | undefined;
  if (!claims) throw new Error('id_token yok');
  // Doğrulanmadığı açıkça bildirilen e-posta kimlik eşlemede kullanılmaz.
  if (claims.email_verified === false && cfg.emailClaim === 'email') throw new Error('email_not_verified');
  return {
    subject: String(claims.sub),
    email: firstString(claims[cfg.emailClaim]) || firstString(claims.email) || firstString(claims.preferred_username),
    name: firstString(claims[cfg.nameClaim]),
    groups: asList(claims[cfg.groupsClaim]),
  };
}

// ==================== SAML ====================

/** InResponseTo tekrar kullanımını engelleyen Redis önbelleği (yanıt yeniden oynatılamaz). */
export function redisSamlCache(redis: Redis, prefix: string, ttlSeconds = 10 * 60): CacheProvider {
  return {
    async saveAsync(key, value) {
      await redis.set(`${prefix}${key}`, value, 'EX', ttlSeconds);
      return { value, createdAt: Date.now() };
    },
    getAsync: (key) => redis.get(`${prefix}${key}`),
    async removeAsync(key) {
      if (!key) return null;
      const value = await redis.get(`${prefix}${key}`);
      await redis.del(`${prefix}${key}`);
      return value;
    },
  };
}

export function samlClient(cfg: SamlConfig, spEntityId: string, callbackUrl: string, cache: CacheProvider): SAML {
  return new SAML({
    entryPoint: cfg.entryPoint,
    idpCert: cfg.idpCert,
    issuer: cfg.spEntityId || spEntityId,
    callbackUrl,
    // İmzasız yanıt kabul edilmez; InResponseTo her zaman beklenir (IdP-initiated giriş yok).
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    validateInResponseTo: ValidateInResponseTo.always,
    cacheProvider: cache,
    requestIdExpirationPeriodMs: 10 * 60 * 1000,
    acceptedClockSkewMs: 60 * 1000,
    identifierFormat: null,
  });
}

export function samlIdentity(profile: Profile, cfg: SamlConfig): SsoIdentity {
  const attrs = profile as unknown as Record<string, unknown>;
  return {
    subject: profile.nameID,
    email: firstString(attrs[cfg.emailAttribute]) || firstString(profile.email) || (profile.nameID.includes('@') ? profile.nameID : ''),
    name: firstString(attrs[cfg.nameAttribute]),
    groups: asList(attrs[cfg.groupsAttribute]),
  };
}

// ==================== LDAP / AD ====================

export class LdapAuthError extends Error {}

/**
 * Servis hesabıyla kullanıcıyı arar, ardından kullanıcının DN'i ve parolasıyla
 * bind ederek parolayı doğrular. Kullanıcı adı filtreye KAÇIŞLANARAK yerleşir
 * (LDAP injection: `*)(uid=*` gibi girdiler).
 */
export async function ldapAuthenticate(
  cfg: LdapConfig,
  bindPassword: string,
  username: string,
  password: string,
): Promise<SsoIdentity> {
  // Boş parola çoğu dizinde "anonymous bind" olarak BAŞARILI sayılır — asla kabul etme.
  if (!password) throw new LdapAuthError('empty_password');
  const tlsOptions = { rejectUnauthorized: cfg.tlsRejectUnauthorized };
  // ldapts `tlsOptions` verilince doğrudan TLS ile bağlanır; düz ldap:// (+ StartTLS)
  // için yalnızca ldaps:// adreslerinde geçirilir.
  const connect = () => new LdapClient({
    url: cfg.url,
    ...(cfg.url.toLowerCase().startsWith('ldaps://') ? { tlsOptions } : {}),
    timeout: 10_000,
    connectTimeout: 10_000,
  });
  const client = connect();
  try {
    if (cfg.startTls) await client.startTLS(tlsOptions);
    await client.bind(cfg.bindDn, bindPassword);
    const filter = cfg.userFilter.split('{{username}}').join(Filter.escape(username));
    const { searchEntries } = await client.search(cfg.baseDn, {
      scope: 'sub',
      filter,
      sizeLimit: 2,
      attributes: ['dn', cfg.emailAttribute, cfg.nameAttribute, cfg.groupsAttribute],
    });
    // Belirsiz eşleşme (birden çok kullanıcı) reddedilir.
    if (searchEntries.length !== 1) throw new LdapAuthError('user_not_found');
    const entry = searchEntries[0];

    const userClient = connect();
    try {
      if (cfg.startTls) await userClient.startTLS(tlsOptions);
      await userClient.bind(entry.dn, password);
    } catch {
      throw new LdapAuthError('invalid_credentials');
    } finally {
      await userClient.unbind().catch(() => undefined);
    }

    return {
      subject: entry.dn,
      email: firstString(entry[cfg.emailAttribute]),
      name: firstString(entry[cfg.nameAttribute]),
      groups: asList(entry[cfg.groupsAttribute]),
    };
  } finally {
    await client.unbind().catch(() => undefined);
  }
}
