import { describe, it, expect, vi } from 'vitest';
import type { IdentityProvider, PrismaClient } from '@prisma/client';
import { groupMatches, resolveCompanies, resolveRole, resolveSsoStaff } from '../../src/services/sso/resolve.js';

describe('grup eşleme', () => {
  it('büyük/küçük harf duyarsız; LDAP DN ilk CN ile de eşleşir', () => {
    expect(groupMatches('IT-Admins', 'it-admins')).toBe(true);
    expect(groupMatches('CN=IT-Admins,OU=Groups,DC=firma,DC=local', 'IT-Admins')).toBe(true);
    expect(groupMatches('CN=IT-Admins,OU=Groups,DC=firma,DC=local', 'cn=it-admins,ou=groups,dc=firma,dc=local')).toBe(true);
    expect(groupMatches('CN=IT-Admins-Old,OU=Groups', 'IT-Admins')).toBe(false);
  });

  it('birden çok eşleşmede en yüksek rol kazanır', () => {
    const mappings = [
      { group: 'it', role: 'it_staff' as const },
      { group: 'it-lead', role: 'it_manager' as const },
    ];
    expect(resolveRole(['it', 'it-lead'], mappings)).toBe('it_manager');
    expect(resolveRole(['sales'], mappings)).toBeNull();
  });

  it('şirketler eşleşen grupların birleşimidir', () => {
    expect(resolveCompanies(['a', 'b'], [{ group: 'a', companyId: 'c1' }, { group: 'b', companyId: 'c2' }, { group: 'x', companyId: 'c3' }]))
      .toEqual(['c1', 'c2']);
  });
});

type Row = Record<string, unknown>;

function provider(o: Partial<IdentityProvider> = {}): IdentityProvider {
  return {
    id: 'idp-1', slug: 'entra', name: 'Entra', type: 'oidc', isActive: true, config: {}, secretEnc: null,
    jitProvisioning: false, roleMappings: [], companyMappings: [], createdAt: new Date(), updatedAt: new Date(), ...o,
  };
}

function prismaWith(opts: { linked?: Row | null; byEmail?: Row | null; companies?: string[] }) {
  const staffUpdate = vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => ({ ...(opts.linked ?? opts.byEmail ?? { isActive: true }), id: where.id, ...data }));
  const staffCreate = vi.fn(async ({ data }: { data: Row }) => ({ id: 'new', isActive: true, ...data }));
  const scDelete = vi.fn(async () => ({}));
  const scCreate = vi.fn(async () => ({}));
  const tx = {
    staff: { update: staffUpdate },
    company: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.filter(id => (opts.companies ?? []).includes(id)).map(id => ({ id })) },
    staffCompany: { deleteMany: scDelete, createMany: scCreate },
  };
  const prisma = {
    staff: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => ('email' in where ? opts.byEmail ?? null : opts.linked ?? null)),
      create: staffCreate,
    },
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  } as unknown as PrismaClient;
  return { prisma, staffUpdate, staffCreate, scDelete, scCreate };
}

const identity = { subject: 'sub-1', email: 'Ayse@Firma.com', name: 'Ayşe', groups: ['IT-Staff'] };
const existing = { id: 's1', email: 'ayse@firma.com', role: 'it_staff', isActive: true, identityProviderId: null, externalSubject: null };

describe('resolveSsoStaff', () => {
  it('eşleme yoksa mevcut hesap kendi rolüyle bağlanır', async () => {
    const { prisma, staffUpdate } = prismaWith({ byEmail: existing });
    const r = await resolveSsoStaff(prisma, provider(), identity, []);
    expect('staff' in r && r.roleChanged).toBe(false);
    expect(staffUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { identityProviderId: 'idp-1', externalSubject: 'sub-1' } }));
  });

  it('eşleme yoksa bilinmeyen kullanıcıya hesap AÇILMAZ (JIT açık olsa da)', async () => {
    const { prisma, staffCreate } = prismaWith({});
    expect(await resolveSsoStaff(prisma, provider({ jitProvisioning: true }), identity, [])).toEqual({ error: 'no_account' });
    expect(staffCreate).not.toHaveBeenCalled();
  });

  it('rol eşlemesi tanımlı ve hiçbir grup tutmuyorsa mevcut hesap bile giremez', async () => {
    const { prisma } = prismaWith({ byEmail: existing });
    const p = provider({ roleMappings: [{ group: 'IT-Admins', role: 'admin' }] });
    expect(await resolveSsoStaff(prisma, p, identity, [])).toEqual({ error: 'no_matching_group' });
  });

  it('rol gruplardan senkronlanır ve değişiklik bildirilir', async () => {
    const { prisma, staffUpdate } = prismaWith({ byEmail: existing });
    const p = provider({ roleMappings: [{ group: 'IT-Staff', role: 'it_manager' }] });
    const r = await resolveSsoStaff(prisma, p, identity, []);
    expect(r).toMatchObject({ roleChanged: true });
    expect(staffUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: 'it_manager' }) }));
  });

  it('JIT: eşleşen grupla yeni hesap; şirketler var olanlarla senkronlanır', async () => {
    const { prisma, staffCreate, scDelete, scCreate } = prismaWith({ companies: ['c1'] });
    const p = provider({
      jitProvisioning: true,
      roleMappings: [{ group: 'IT-Staff', role: 'it_staff' }],
      companyMappings: [{ group: 'IT-Staff', companyId: 'c1' }, { group: 'IT-Staff', companyId: 'deleted' }],
    });
    const r = await resolveSsoStaff(prisma, p, identity, []);
    expect('staff' in r).toBe(true);
    expect(staffCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ email: 'ayse@firma.com', role: 'it_staff', externalSubject: 'sub-1' }) });
    expect(scDelete).toHaveBeenCalled();
    expect(scCreate).toHaveBeenCalledWith({ data: [{ staffId: 'new', companyId: 'c1' }] });
  });

  it('izinli domain dışı reddedilir', async () => {
    const { prisma } = prismaWith({ byEmail: existing });
    expect(await resolveSsoStaff(prisma, provider(), identity, ['baska.com'])).toEqual({ error: 'domain_not_allowed' });
  });

  it('aynı e-posta farklı bir kimliğe zaten bağlıysa reddedilir', async () => {
    const { prisma } = prismaWith({ byEmail: { ...existing, identityProviderId: 'idp-1', externalSubject: 'someone-else' } });
    expect(await resolveSsoStaff(prisma, provider(), identity, [])).toEqual({ error: 'identity_conflict' });
  });

  it('pasif hesap giremez', async () => {
    const { prisma } = prismaWith({ byEmail: { ...existing, isActive: false } });
    expect(await resolveSsoStaff(prisma, provider(), identity, [])).toEqual({ error: 'inactive' });
  });
});
