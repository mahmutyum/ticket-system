import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  getStaffCompanyScope,
  companyWhereClause,
  isCompanyInScope,
  resolveCompanyFilter,
} from '../../src/utils/staff-scope.js';

/**
 * Şirket kapsamı, çok şirketli izolasyonun tek dayanağıdır: `admin` dışındaki
 * her rol yalnızca atandığı şirketleri görmelidir.
 *
 * Buradaki testler iki gerçek açığa karşı da nöbet tutar:
 *  1. atama yoksa sınırsız erişim veren fail-open varsayılan,
 *  2. istemciden gelen `companyId` filtresinin kapsamı ezmesi.
 */

/** Sahte Prisma — yalnızca staffCompany.findMany kullanılır. */
function fakePrisma(assignments: string[]): PrismaClient {
  return {
    staffCompany: {
      findMany: async () => assignments.map((companyId) => ({ companyId })),
    },
  } as unknown as PrismaClient;
}

describe('getStaffCompanyScope', () => {
  it('admin için null döner — kısıt yok', async () => {
    // Atama olsa bile admin sınırsızdır.
    const scope = await getStaffCompanyScope(fakePrisma(['c1']), 'staff-1', 'admin');
    expect(scope).toBeNull();
  });

  it('it_manager için atanan şirketlerle sınırlar', async () => {
    const scope = await getStaffCompanyScope(fakePrisma(['c1', 'c2']), 'staff-1', 'it_manager');
    expect(scope).toEqual(['c1', 'c2']);
  });

  it('it_staff için atanan şirketlerle sınırlar', async () => {
    const scope = await getStaffCompanyScope(fakePrisma(['c1']), 'staff-1', 'it_staff');
    expect(scope).toEqual(['c1']);
  });

  it('ataması olmayan it_manager hiçbir şey görmez (fail-closed)', async () => {
    // Regresyon: eskiden null (=tüm şirketler) dönüyordu.
    const scope = await getStaffCompanyScope(fakePrisma([]), 'staff-1', 'it_manager');
    expect(scope).toEqual([]);
    expect(scope).not.toBeNull();
  });

  it('ataması olmayan it_staff hiçbir şey görmez (fail-closed)', async () => {
    // Regresyon: "backward compat" gerekçesiyle sınırsız erişim veriliyordu.
    const scope = await getStaffCompanyScope(fakePrisma([]), 'staff-1', 'it_staff');
    expect(scope).toEqual([]);
    expect(scope).not.toBeNull();
  });
});

describe('companyWhereClause', () => {
  it('null kapsam için boş kısıt üretir', () => {
    expect(companyWhereClause(null)).toEqual({});
  });

  it('kapsamı IN kısıtına çevirir', () => {
    expect(companyWhereClause(['c1', 'c2'])).toEqual({ companyId: { in: ['c1', 'c2'] } });
  });

  it('boş kapsam hiçbir kaydı eşleştirmez', () => {
    // {} DÖNMEMELİ — {} "kısıt yok" demektir ve her kaydı açardı.
    expect(companyWhereClause([])).toEqual({ companyId: { in: [] } });
  });
});

describe('isCompanyInScope', () => {
  it('admin her şirkete erişir', () => {
    expect(isCompanyInScope(null, 'c1')).toBe(true);
  });

  it('admin global (companyId=null) kayıtlara erişir', () => {
    expect(isCompanyInScope(null, null)).toBe(true);
  });

  it('kapsam içindeki şirkete izin verir', () => {
    expect(isCompanyInScope(['c1', 'c2'], 'c2')).toBe(true);
  });

  it('kapsam dışındaki şirketi reddeder', () => {
    expect(isCompanyInScope(['c1'], 'c2')).toBe(false);
  });

  it('kapsamlı kullanıcı global (companyId=null) kayda erişemez', () => {
    // Global kayıtlar çapraz şirket sırlarıdır — yalnızca admin.
    expect(isCompanyInScope(['c1'], null)).toBe(false);
    expect(isCompanyInScope(['c1'], undefined)).toBe(false);
  });

  it('boş kapsam her şeyi reddeder', () => {
    expect(isCompanyInScope([], 'c1')).toBe(false);
    expect(isCompanyInScope([], null)).toBe(false);
  });
});

describe('resolveCompanyFilter', () => {
  it('admin filtresiz ise kısıt koymaz', () => {
    expect(resolveCompanyFilter(null)).toEqual({});
  });

  it('admin istediği şirkete filtreleyebilir', () => {
    expect(resolveCompanyFilter(null, 'c9')).toEqual({ companyId: 'c9' });
  });

  it('kapsamlı kullanıcı filtresiz ise tüm kapsamını görür', () => {
    expect(resolveCompanyFilter(['c1', 'c2'])).toEqual({ companyId: { in: ['c1', 'c2'] } });
  });

  it('kapsam içi filtreyi uygular', () => {
    expect(resolveCompanyFilter(['c1', 'c2'], 'c2')).toEqual({ companyId: { in: ['c2'] } });
  });

  it('kapsam DIŞI filtre hiçbir kaydı eşleştirmez — yetki aşımına kapalı', () => {
    // Regresyon: `where.companyId = query.companyId` deseni kapsamı eziyordu ve
    // ?companyId=<başka-şirket> ile başka şirketin verisi okunabiliyordu.
    expect(resolveCompanyFilter(['c1'], 'c2')).toEqual({ companyId: { in: [] } });
  });

  it('kapsam dışı filtre kapsamı GENİŞLETEMEZ', () => {
    const result = resolveCompanyFilter(['c1'], 'c2');
    expect(result).not.toEqual({ companyId: 'c2' });
    expect(result.companyId).toEqual({ in: [] });
    if (typeof result.companyId !== 'object') {
      throw new Error('Kapsamlı filtre Prisma `in` koşulu üretmelidir');
    }
    expect(result.companyId.in).not.toContain('c2');
  });

  it('boş kapsamlı kullanıcı filtre verse de hiçbir şey göremez', () => {
    expect(resolveCompanyFilter([], 'c1')).toEqual({ companyId: { in: [] } });
    expect(resolveCompanyFilter([])).toEqual({ companyId: { in: [] } });
  });
});
