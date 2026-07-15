import { z } from 'zod';

/**
 * Ticket listesinde sıralanabilecek alanlar.
 *
 * `sortBy` doğrudan Prisma'nın `orderBy` anahtarına gidiyor. Serbest `z.string()`
 * iken `?sortBy=bogus` Prisma'da hata fırlatıyordu; bu hatanın `statusCode`'u
 * olmadığı için global handler 500 döndürüyor ve her istekte error log yazıyordu —
 * yani herhangi bir personelin tek parametreyle üretebildiği bir gürültü/DoS.
 * Bir ilişki adı (`?sortBy=company`) de aynı sonucu veriyordu.
 */
export const TICKET_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'ticketNumber',
  'priority',
  'status',
  'slaResponseDue',
  'slaResolveDue',
] as const;

export const paginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  sortBy: z.enum(TICKET_SORT_FIELDS).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type PaginationParams = z.infer<typeof paginationSchema>;

export function paginate(params: PaginationParams) {
  const { page, limit } = params;
  return {
    skip: (page - 1) * limit,
    take: limit,
  };
}

export function paginatedResponse<T>(data: T[], total: number, params: PaginationParams) {
  const { page, limit } = params;
  return {
    success: true,
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}
