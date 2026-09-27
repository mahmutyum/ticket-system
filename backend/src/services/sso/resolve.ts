import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { StaffRole, type IdentityProvider, type PrismaClient, type Staff } from '@prisma/client';
import { companyMappingSchema, roleMappingSchema, type CompanyMapping, type RoleMapping } from './config.js';

/**
 * SSO kimliğinden personel hesabına: eşleme, bağlama, JIT ve grup senkronizasyonu.
 *
 * Kurallar (bilinçli olarak sıkı):
 * - Rol eşlemesi TANIMLIYSA her girişte rol gruplardan hesaplanır; hiçbir rol grubu
 *   tutmazsa giriş REDDEDİLİR (dizinde IT grubundan çıkarılan kişi erişimini kaybeder).
 * - Rol eşlemesi yoksa mevcut hesap kendi rolüyle girer; yeni hesap AÇILMAZ.
 * - JIT (yeni hesap) yalnızca ayar açıksa VE bir rol grubu eşleşiyorsa.
 * - Şirket eşlemesi tanımlıysa atamalar her girişte eşleşen gruplarla değiştirilir.
 * - Aynı e-postalı mevcut hesap ilk girişte bağlanır; farklı bir kimlikle zaten
 *   bağlıysa reddedilir (e-postayı taklit eden ikinci bir IdP hesabı devralamaz).
 */

export interface SsoIdentity {
  /** Sağlayıcıdaki kalıcı kimlik: OIDC `sub`, SAML NameID, LDAP DN. */
  subject: string;
  email: string;
  name: string;
  groups: string[];
}

export type SsoFailure =
  | 'no_email'
  | 'domain_not_allowed'
  | 'no_matching_group'
  | 'no_account'
  | 'inactive'
  | 'identity_conflict';

/** `roleChanged`: eski access token'lar eski rolü taşır → çağıran geçersiz kılmalı. */
export type SsoResolution = { staff: Staff; roleChanged: boolean } | { error: SsoFailure };

const ROLE_RANK: Record<StaffRole, number> = { it_staff: 1, it_manager: 2, admin: 3 };

/**
 * Grup eşleşmesi büyük/küçük harf duyarsızdır. LDAP `memberOf` tam DN döndürür;
 * eşleme hem tam DN ile hem de DN'nin ilk CN'i ile yazılabilir ("IT-Admins").
 */
export function groupMatches(actual: string, expected: string): boolean {
  const a = actual.trim().toLowerCase();
  const e = expected.trim().toLowerCase();
  if (a === e) return true;
  const cn = /^cn=([^,]+)/i.exec(actual.trim());
  return !!cn && cn[1].trim().toLowerCase() === e;
}

export function resolveRole(groups: string[], mappings: RoleMapping[]): StaffRole | null {
  let best: StaffRole | null = null;
  for (const m of mappings) {
    if (groups.some(g => groupMatches(g, m.group)) && (!best || ROLE_RANK[m.role] > ROLE_RANK[best])) best = m.role;
  }
  return best;
}

export function resolveCompanies(groups: string[], mappings: CompanyMapping[]): string[] {
  return [...new Set(mappings.filter(m => groups.some(g => groupMatches(g, m.group))).map(m => m.companyId))];
}

export function isDomainAllowed(email: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true;
  const domain = email.split('@')[1]?.toLowerCase();
  return !!domain && allowedDomains.includes(domain);
}

/** SSO ile açılan hesapların kullanılamaz rastgele parolası (yerel giriş yapılamaz). */
async function unusablePasswordHash(): Promise<string> {
  return bcrypt.hash(randomBytes(32).toString('hex'), 12);
}

export async function resolveSsoStaff(
  prisma: PrismaClient,
  provider: IdentityProvider,
  identity: SsoIdentity,
  allowedDomains: string[],
): Promise<SsoResolution> {
  const email = identity.email.trim().toLowerCase();
  if (!email || !email.includes('@')) return { error: 'no_email' };
  if (!isDomainAllowed(email, allowedDomains)) return { error: 'domain_not_allowed' };

  const roleMappings = roleMappingSchema.parse(provider.roleMappings);
  const companyMappings = companyMappingSchema.parse(provider.companyMappings);
  const mappedRole = roleMappings.length ? resolveRole(identity.groups, roleMappings) : null;
  if (roleMappings.length && !mappedRole) return { error: 'no_matching_group' };

  const linked = await prisma.staff.findUnique({
    where: { identityProviderId_externalSubject: { identityProviderId: provider.id, externalSubject: identity.subject } },
  });
  let staff = linked ?? (await prisma.staff.findUnique({ where: { email } }));

  if (staff && !linked && staff.identityProviderId === provider.id && staff.externalSubject && staff.externalSubject !== identity.subject) {
    return { error: 'identity_conflict' };
  }

  if (!staff) {
    if (!provider.jitProvisioning || !mappedRole) return { error: 'no_account' };
    staff = await prisma.staff.create({
      data: {
        email,
        fullName: identity.name.trim() || email.split('@')[0],
        passwordHash: await unusablePasswordHash(),
        role: mappedRole,
        identityProviderId: provider.id,
        externalSubject: identity.subject,
      },
    });
  }
  if (!staff.isActive) return { error: 'inactive' };

  const previousRole = staff.role;
  const companyIds = companyMappings.length ? resolveCompanies(identity.groups, companyMappings) : null;
  staff = await prisma.$transaction(async (tx) => {
    const updated = await tx.staff.update({
      where: { id: staff!.id },
      data: {
        identityProviderId: provider.id,
        externalSubject: identity.subject,
        ...(mappedRole ? { role: mappedRole } : {}),
      },
    });
    if (companyIds) {
      // Yalnızca var olan şirketler atanır (eşlemede silinmiş şirket kalmış olabilir).
      const existing = await tx.company.findMany({ where: { id: { in: companyIds } }, select: { id: true } });
      await tx.staffCompany.deleteMany({ where: { staffId: updated.id } });
      if (existing.length) {
        await tx.staffCompany.createMany({ data: existing.map(c => ({ staffId: updated.id, companyId: c.id })) });
      }
    }
    return updated;
  });

  return { staff, roleChanged: staff.role !== previousRole };
}
