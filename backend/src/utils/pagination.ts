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

/**
 * Ticket dışı listeler için ortak sayfalama girdisi. Ticket listesindeki
 * `sortBy`/`sortOrder` ticket alanlarına özel beyaz listeye bağlıdır; diğer
 * listeler sıralamayı uç bazında sabitler, yalnızca sayfa/limit alır.
 */
export const pageParamsSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export type PageParams = z.infer<typeof pageParamsSchema>;

/** Yanıt şemalarında yeniden kullanılan `pagination` bloğu. */
export const paginationMetaSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

export function paginate(params: PageParams) {
  const { page, limit } = params;
  return {
    skip: (page - 1) * limit,
    take: limit,
  };
}

export function paginatedResponse<T>(data: T[], total: number, params: PageParams) {
  const { page, limit } = params;
  return {
    success: true as const,
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}
