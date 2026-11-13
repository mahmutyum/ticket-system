import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Prisma, StaffRole, type KbArticle } from '@prisma/client';
import { createAuditLog } from '../../middleware/audit.js';
import { commonErrorResponses, successResponseSchema } from '../../utils/api-schema.js';
import { pageParamsSchema, paginate, paginationMetaSchema, paginatedResponse } from '../../utils/pagination.js';
import { companyScopeChecker } from '../../utils/route-scope.js';
import { isCompanyInScope } from '../../utils/staff-scope.js';
import { t } from '../../i18n/index.js';

/**
 * Bilgi bankası.
 *
 * Kapsam kuralları (şirket verisi gibi): personel yalnızca kapsamındaki şirketlerin
 * ve global makaleleri görür; global makaleyi yalnızca admin yazar. Public uçlar
 * yalnızca YAYINDAKİ makaleleri döner; şirkete özel makale yalnızca o şirketin
 * portalından (companyId eşleşmesiyle) okunur.
 */

const idParams = z.object({ id: z.string().min(1).max(128) });
const locale = z.enum(['tr', 'en']).default('tr');

const articleBody = z.object({
  companyId: z.string().max(128).nullable().default(null),
  categoryId: z.string().max(128).nullable().default(null),
  titleTr: z.string().trim().min(3).max(200),
  bodyTr: z.string().trim().min(1).max(50_000),
  titleEn: z.string().trim().max(200).nullable().optional(),
  bodyEn: z.string().trim().max(50_000).nullable().optional(),
  isPublished: z.boolean().default(false),
});

const staffArticleSchema = z.object({
  id: z.string(), companyId: z.string().nullable(), categoryId: z.string().nullable(),
  titleTr: z.string(), bodyTr: z.string(), titleEn: z.string().nullable(), bodyEn: z.string().nullable(),
  isPublished: z.boolean(), viewCount: z.number(), helpfulYes: z.number(), helpfulNo: z.number(), deflections: z.number(),
  createdBy: z.string().nullable(), createdAt: z.date(), updatedAt: z.date(),
  company: z.object({ name: z.string() }).nullable(), category: z.object({ name: z.string() }).nullable(),
});

const publicSummarySchema = z.object({ id: z.string(), title: z.string(), excerpt: z.string(), categoryId: z.string().nullable() });
const publicArticleSchema = z.object({ id: z.string(), title: z.string(), body: z.string(), categoryId: z.string().nullable(), updatedAt: z.date() });

/** Markdown'dan düz metin özet (arama sonuçları / öneriler için). */
export function excerpt(markdown: string, max = 180): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const localized = (a: KbArticle, lang: 'tr' | 'en') => ({
  title: lang === 'en' && a.titleEn ? a.titleEn : a.titleTr,
  body: lang === 'en' && a.bodyEn ? a.bodyEn : a.bodyTr,
});

/** Aramaya uygun koşul: iki dilde başlık/gövde. */
const searchWhere = (q?: string): Prisma.KbArticleWhereInput =>
  q && q.trim().length >= 2
    ? {
        OR: ['titleTr', 'bodyTr', 'titleEn', 'bodyEn'].map(field => ({ [field]: { contains: q.trim(), mode: 'insensitive' } })),
      }
    : {};

export const kbRoutes: FastifyPluginAsyncZod = async (app) => {
  const include = { company: { select: { name: true } }, category: { select: { name: true } } } as const;

  /** Yazma yetkisi: global → yalnızca admin; şirkete özel → kapsam. */
  async function canWrite(request: FastifyRequest, reply: FastifyReply, companyId: string | null): Promise<boolean> {
    if (companyId === null && request.staffUser!.role !== StaffRole.admin) {
      reply.status(403).send({ success: false, error: t(request, 'kb.global_admin_only') });
      return false;
    }
    if (companyId !== null && !(await companyScopeChecker(app.prisma, request).inScope(reply, companyId, t(request, 'kb.forbidden')))) {
      return false;
    }
    return true;
  }

  async function validRefs(request: FastifyRequest, reply: FastifyReply, body: z.infer<typeof articleBody>): Promise<boolean> {
    if (body.categoryId) {
      const category = await app.prisma.category.findUnique({ where: { id: body.categoryId }, select: { companyId: true } });
      // Kategori global ya da makalenin şirketine ait olmalı.
      if (!category || (category.companyId !== null && category.companyId !== body.companyId)) {
        reply.status(400).send({ success: false, error: t(request, 'kb.invalid_category') });
        return false;
      }
    }
    return true;
  }

  app.get('/', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Knowledge Base'],
      summary: 'Bilgi bankası makalelerini sayfalı listeler',
      querystring: pageParamsSchema.extend({
        q: z.string().max(200).optional(),
        companyId: z.string().max(128).optional(),
        categoryId: z.string().max(128).optional(),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.array(staffArticleSchema),
          pagination: paginationMetaSchema,
        }),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    const companyIds = await companyScopeChecker(app.prisma, request).of();
    const { q, companyId, categoryId } = request.query;
    // companyId filtresi kapsamla KESİŞTİRİLİR.
    if (companyId && !isCompanyInScope(companyIds, companyId)) {
      return reply.send(paginatedResponse([], 0, request.query));
    }
    const companyWhere: Prisma.KbArticleWhereInput = companyId
      ? { OR: [{ companyId }, { companyId: null }] }
      : companyIds ? { OR: [{ companyId: { in: companyIds } }, { companyId: null }] } : {};
    const where = { AND: [companyWhere, searchWhere(q), categoryId ? { categoryId } : {}] };
    const [articles, total] = await Promise.all([
      app.prisma.kbArticle.findMany({ where, include, orderBy: { updatedAt: 'desc' }, ...paginate(request.query) }),
      app.prisma.kbArticle.count({ where }),
    ]);
    reply.send(paginatedResponse(articles, total, request.query));
  });

  app.get('/:id', {
    preValidation: [app.authenticate],
    schema: { tags: ['Knowledge Base'], summary: 'Makale', params: idParams, response: { 200: z.object({ success: z.literal(true), data: staffArticleSchema }), ...commonErrorResponses } },
  }, async (request, reply) => {
    const article = await app.prisma.kbArticle.findUnique({ where: { id: request.params.id }, include });
    if (!article || (article.companyId && !isCompanyInScope(await companyScopeChecker(app.prisma, request).of(), article.companyId))) {
      return reply.status(404).send({ success: false, error: t(request, 'kb.not_found') });
    }
    reply.send({ success: true, data: article });
  });

  app.post('/', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: { tags: ['Knowledge Base'], summary: 'Makale ekler', body: articleBody, response: { 200: z.object({ success: z.literal(true), data: staffArticleSchema }), ...commonErrorResponses } },
  }, async (request, reply) => {
    const body = request.body;
    if (!(await canWrite(request, reply, body.companyId)) || !(await validRefs(request, reply, body))) return;
    const article = await app.prisma.kbArticle.create({
      data: { ...body, titleEn: body.titleEn || null, bodyEn: body.bodyEn || null, createdBy: request.staffUser!.email },
      include,
    });
    await createAuditLog({ entityType: 'kb_article', entityId: article.id, action: 'create', changes: { title: body.titleTr, companyId: body.companyId, isPublished: body.isPublished }, performedBy: request.staffUser!.email, ipAddress: request.ip });
    reply.send({ success: true, data: article });
  });

  app.put('/:id', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: { tags: ['Knowledge Base'], summary: 'Makale günceller', params: idParams, body: articleBody, response: { 200: z.object({ success: z.literal(true), data: staffArticleSchema }), ...commonErrorResponses } },
  }, async (request, reply) => {
    const existing = await app.prisma.kbArticle.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.status(404).send({ success: false, error: t(request, 'kb.not_found') });
    const body = request.body;
    // Hem eski hem yeni şirkette yetki gerekir (başka şirkete taşıma / oradan alma).
    if (!(await canWrite(request, reply, existing.companyId)) || !(await canWrite(request, reply, body.companyId))) return;
    if (!(await validRefs(request, reply, body))) return;
    const article = await app.prisma.kbArticle.update({
      where: { id: existing.id },
      data: { ...body, titleEn: body.titleEn || null, bodyEn: body.bodyEn || null },
      include,
    });
    await createAuditLog({ entityType: 'kb_article', entityId: article.id, action: 'update', changes: { title: body.titleTr, companyId: body.companyId, isPublished: body.isPublished }, performedBy: request.staffUser!.email, ipAddress: request.ip });
    reply.send({ success: true, data: article });
  });

  app.delete('/:id', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: { tags: ['Knowledge Base'], summary: 'Makale siler', params: idParams, response: { 200: successResponseSchema, ...commonErrorResponses } },
  }, async (request, reply) => {
    const existing = await app.prisma.kbArticle.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.status(404).send({ success: false, error: t(request, 'kb.not_found') });
    if (!(await canWrite(request, reply, existing.companyId))) return;
    await app.prisma.kbArticle.delete({ where: { id: existing.id } });
    await createAuditLog({ entityType: 'kb_article', entityId: existing.id, action: 'delete', changes: { title: existing.titleTr }, performedBy: request.staffUser!.email, ipAddress: request.ip });
    reply.send({ success: true });
  });
};

export const kbPublicRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Portalın şirketi: aktif olmalı; yoksa yalnızca global makaleler. */
  async function companyFilter(companyId?: string): Promise<Prisma.KbArticleWhereInput> {
    if (!companyId) return { companyId: null };
    const company = await app.prisma.company.findUnique({ where: { id: companyId }, select: { isActive: true } });
    return company?.isActive ? { OR: [{ companyId }, { companyId: null }] } : { companyId: null };
  }

  app.get('/', {
    schema: {
      tags: ['Knowledge Base'],
      summary: 'Yayındaki makaleleri arar',
      querystring: z.object({
        q: z.string().max(200).optional(),
        companyId: z.string().max(128).optional(),
        categoryId: z.string().max(128).optional(),
        locale,
      }),
      response: { 200: z.object({ success: z.literal(true), data: z.array(publicSummarySchema) }) },
    },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { q, companyId, categoryId, locale: lang } = request.query;
    // Bu uç public portal araması + sihirbaz önerisidir; her makale yalnızca
    // özet döner. Sıralama yararlılığı yansıtır (en çok işe yarayan üstte) ve
    // tavan bilinçlidir: portal arayüzü sayfalama göstermez, isabet kümesi
    // küçük tutulur. Sayfalama personel listesinde (/kb) vardır.
    const articles = await app.prisma.kbArticle.findMany({
      where: { AND: [{ isPublished: true }, await companyFilter(companyId), searchWhere(q), categoryId ? { categoryId } : {}] },
      orderBy: [{ helpfulYes: 'desc' }, { viewCount: 'desc' }],
      take: categoryId ? 5 : 50,
    });
    reply.send({
      success: true,
      data: articles.map(a => {
        const l = localized(a, lang);
        return { id: a.id, title: l.title, excerpt: excerpt(l.body), categoryId: a.categoryId };
      }),
    });
  });

  app.get('/:id', {
    schema: {
      tags: ['Knowledge Base'],
      summary: 'Yayındaki makale',
      params: idParams,
      querystring: z.object({ companyId: z.string().max(128).optional(), locale }),
      response: { 200: z.object({ success: z.literal(true), data: publicArticleSchema }), ...commonErrorResponses },
    },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { companyId, locale: lang } = request.query;
    const article = await app.prisma.kbArticle.findFirst({
      where: { AND: [{ id: request.params.id, isPublished: true }, await companyFilter(companyId)] },
    });
    if (!article) return reply.status(404).send({ success: false, error: t(request, 'kb.not_found') });
    await app.prisma.kbArticle.update({ where: { id: article.id }, data: { viewCount: { increment: 1 } } });
    const l = localized(article, lang);
    reply.send({ success: true, data: { id: article.id, title: l.title, body: l.body, categoryId: article.categoryId, updatedAt: article.updatedAt } });
  });

  app.post('/:id/feedback', {
    schema: {
      tags: ['Knowledge Base'],
      summary: '"Bu yardımcı oldu mu?" geri bildirimi',
      params: idParams,
      body: z.object({ helpful: z.boolean(), deflected: z.boolean().default(false) }),
      response: { 200: successResponseSchema, ...commonErrorResponses },
    },
    config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    const { helpful, deflected } = request.body;
    const result = await app.prisma.kbArticle.updateMany({
      where: { id: request.params.id, isPublished: true },
      data: {
        ...(helpful ? { helpfulYes: { increment: 1 } } : { helpfulNo: { increment: 1 } }),
        ...(helpful && deflected ? { deflections: { increment: 1 } } : {}),
      },
    });
    if (result.count === 0) return reply.status(404).send({ success: false, error: t(request, 'kb.not_found') });
    reply.send({ success: true });
  });
};
