import { PrismaClient } from '@prisma/client';

/**
 * Bir personelin erişebileceği şirket id'leri.
 *
 * - `admin`                → `null` (kısıt yok, tüm şirketler)
 * - `it_manager`/`it_staff` → atandığı şirketlerin id'leri (`StaffCompany`)
 *
 * Atama yoksa **boş dizi** döner: hiçbir şey görmez (fail-closed).
 *
 * Kapsam her istekte veritabanından okunur, JWT'de taşınmaz — bu yüzden atama
 * değişiklikleri anında etkili olur, token yenilemeye gerek kalmaz.
 */
export async function getStaffCompanyScope(
  prisma: PrismaClient,
  staffId: string,
  staffRole: string,
): Promise<string[] | null> {
  // Yalnızca admin sınırsızdır.
  if (staffRole === 'admin') {
    return null;
  }

  const assignments = await prisma.staffCompany.findMany({
    where: { staffId },
    select: { companyId: true },
  });

  return assignments.map((a) => a.companyId);
}

/**
 * Kapsamı Prisma `where` fragment'ine çevirir.
 * `null` → `{}` (kısıt yok). Boş dizi → hiçbir kayıt eşleşmez.
 */
export function companyWhereClause(companyIds: string[] | null): Record<string, any> {
  if (!companyIds) return {};
  return { companyId: { in: companyIds } };
}

/**
 * Tek bir `companyId` kapsam içinde mi?
 *
 * `companyId` null ise ("global" kayıt) **yalnızca admin** erişebilir: global
 * kayıtlar çapraz şirket sırları olma eğilimindedir (`CredentialEntry`,
 * `Category`, `CustomField` hepsinde companyId opsiyoneldir).
 *
 * Bu politikayı `IN` semantiğine bırakma — Postgres'te `IN (...)` NULL'ları
 * zaten dışlar ama bu tesadüfi bir koruma; ileride `OR: [{ companyId: null }]`
 * eklenirse sessizce tersine döner. Bu yüzden açıkça kontrol edilir.
 */
export function isCompanyInScope(
  scope: string[] | null,
  companyId: string | null | undefined,
): boolean {
  if (scope === null) return true; // admin
  if (!companyId) return false; // global kayıt → yalnızca admin
  return scope.includes(companyId);
}

/**
 * Kullanıcının gönderdiği `companyId` filtresini kapsamla **kesiştirir**.
 *
 * Kapsam `where`'e yazılıp ardından kullanıcı parametresiyle üzerine yazılırsa
 * tek parametrelik bir yetki aşımı doğar (`?companyId=<başka-şirket>`). Bu
 * yüzden istemciden gelen her companyId filtresi buradan geçmelidir; asla
 * doğrudan `where.companyId`'ye atanmamalıdır.
 *
 * Kapsam dışı bir şirket istenirse hiçbir kayıt eşleşmez.
 */
export function resolveCompanyFilter(
  scope: string[] | null,
  requested?: string | null,
): Record<string, any> {
  if (scope === null) {
    // admin: ne isterse
    return requested ? { companyId: requested } : {};
  }
  if (requested) {
    return { companyId: { in: scope.includes(requested) ? [requested] : [] } };
  }
  return { companyId: { in: scope } };
}
