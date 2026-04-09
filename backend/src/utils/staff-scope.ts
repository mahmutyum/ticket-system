import { PrismaClient } from '@prisma/client';

/**
 * Get the company IDs a staff member can access.
 * - admin / it_manager → null (all companies)
 * - it_staff with no assigned companies → null (all companies, backward compat)
 * - it_staff with assigned companies → array of company IDs
 */
export async function getStaffCompanyScope(
  prisma: PrismaClient,
  staffId: string,
  staffRole: string,
): Promise<string[] | null> {
  // Admin and managers see everything
  if (staffRole === 'admin' || staffRole === 'it_manager') {
    return null;
  }

  const assignments = await prisma.staffCompany.findMany({
    where: { staffId },
    select: { companyId: true },
  });

  // No assignments → unrestricted (backward compatible)
  if (assignments.length === 0) {
    return null;
  }

  return assignments.map(a => a.companyId);
}

/**
 * Build a Prisma where clause fragment for company scoping.
 * Returns {} if no restriction (admin/manager or no assignments).
 */
export function companyWhereClause(companyIds: string[] | null): Record<string, any> {
  if (!companyIds) return {};
  return { companyId: { in: companyIds } };
}
