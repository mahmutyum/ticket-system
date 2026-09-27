import type { FastifyReply, FastifyRequest } from 'fastify';
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { createAuditLog } from '../../middleware/audit.js';
import { getStaffCompanyScope, isCompanyInScope } from '../../utils/staff-scope.js';
import { commonErrorResponses, errorResponseSchema, successResponseSchema } from '../../utils/api-schema.js';
import { DEFAULT_WEEK, parseSlaSettings, slaSettingsSchema } from '../../utils/sla-settings.js';
import { hasWorkingTime } from '../../utils/business-hours.js';
import { t } from '../../i18n/index.js';

/**
 * Şirket SLA ayarları ve tatil takvimi.
 *
 * Yetki: admin + kapsamındaki şirketler için it_manager. SLA hedefleri operasyonel
 * bir karardır (SMTP gibi altyapı sırrı değil), bu yüzden IT yöneticisi kendi
 * şirketinde düzenleyebilir; kapsam denetimi her uçta tekrarlanır.
 */

const idParamsSchema = z.object({ id: z.string().min(1).max(128) });
const holidayParamsSchema = idParamsSchema.extend({ holidayId: z.string().min(1).max(128) });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)));

const holidaySchema = z.object({ id: z.string(), date: z.string(), name: z.string() });
const slaResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    settings: slaSettingsSchema,
    defaultWeek: z.unknown(),
    holidays: z.array(holidaySchema),
  }),
});

const holidayCreateSchema = z.object({ date: isoDate, name: z.string().trim().min(1).max(120) });
const holidayCopySchema = z.object({
  fromYear: z.number().int().min(2000).max(2100),
  toYear: z.number().int().min(2000).max(2100),
});

const toHoliday = (h: { id: string; date: Date; name: string }) => ({
  id: h.id,
  date: h.date.toISOString().slice(0, 10),
  name: h.name,
});

export const companySlaRoutes: FastifyPluginAsyncZod = async (app) => {
  const guard = [app.requireRole('admin', 'it_manager')];

  /** 404 / 403 → yanıtı gönderir ve false döner. */
  async function checkAccess(request: FastifyRequest, reply: FastifyReply, companyId: string): Promise<boolean> {
    const exists = await app.prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
    if (!exists) {
      reply.status(404).send({ success: false, error: t(request, 'companies.companyNotFound') });
      return false;
    }
    const staffUser = request.staffUser!;
    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    if (!isCompanyInScope(scope, companyId)) {
      reply.status(403).send({ success: false, error: t(request, 'companies.companyForbidden') });
      return false;
    }
    return true;
  }

  async function loadSla(companyId: string) {
    const [company, holidays] = await Promise.all([
      app.prisma.company.findUnique({ where: { id: companyId }, select: { slaSettings: true } }),
      app.prisma.companyHoliday.findMany({ where: { companyId }, orderBy: { date: 'asc' } }),
    ]);
    return {
      settings: parseSlaSettings(company?.slaSettings),
      defaultWeek: DEFAULT_WEEK,
      holidays: holidays.map(toHoliday),
    };
  }

  app.get('/:id/sla', {
    preValidation: guard,
    schema: {
      params: idParamsSchema,
      tags: ['Companies'],
      summary: 'Şirket SLA ayarlarını ve tatil günlerini getir',
      response: { 200: slaResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    if (!(await checkAccess(request, reply, request.params.id))) return;
    reply.send({ success: true, data: await loadSla(request.params.id) });
  });

  app.put('/:id/sla', {
    preValidation: guard,
    schema: {
      params: idParamsSchema,
      body: slaSettingsSchema,
      tags: ['Companies'],
      summary: 'Şirket SLA ayarlarını güncelle',
      response: { 200: slaResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    if (!(await checkAccess(request, reply, id))) return;
    const body = request.body;
    // Mesai takvimi açık ama hiç çalışma aralığı yoksa SLA hiç ilerleyemez.
    if (body.businessHours?.enabled && !hasWorkingTime({ ...body.businessHours, holidays: [] })) {
      return reply.status(400).send({ success: false, error: t(request, 'companies.slaNoWorkingHours') });
    }
    await app.prisma.company.update({
      where: { id },
      data: { slaSettings: body },
    });
    await createAuditLog({
      entityType: 'company', entityId: id, action: 'update_sla', changes: body,
      performedBy: request.staffUser!.email, ipAddress: request.headers['x-real-ip'] as string,
    });
    reply.send({ success: true, data: await loadSla(id) });
  });

  app.post('/:id/holidays', {
    preValidation: guard,
    schema: {
      params: idParamsSchema,
      body: holidayCreateSchema,
      tags: ['Companies'],
      summary: 'Şirkete tatil günü ekle',
      response: { 201: z.object({ success: z.literal(true), data: holidaySchema }), ...commonErrorResponses, 409: errorResponseSchema },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    if (!(await checkAccess(request, reply, id))) return;
    try {
      const holiday = await app.prisma.companyHoliday.create({
        data: { companyId: id, date: new Date(`${request.body.date}T00:00:00Z`), name: request.body.name },
      });
      await createAuditLog({
        entityType: 'company', entityId: id, action: 'holiday_add', changes: request.body,
        performedBy: request.staffUser!.email, ipAddress: request.headers['x-real-ip'] as string,
      });
      reply.status(201).send({ success: true, data: toHoliday(holiday) });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.status(409).send({ success: false, error: t(request, 'companies.holidayExists') });
      }
      throw err;
    }
  });

  app.delete('/:id/holidays/:holidayId', {
    preValidation: guard,
    schema: {
      params: holidayParamsSchema,
      tags: ['Companies'],
      summary: 'Tatil gününü sil',
      response: { 200: successResponseSchema, ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const { id, holidayId } = request.params;
    if (!(await checkAccess(request, reply, id))) return;
    // companyId koşulu: başka şirketin tatil kaydı id ile silinemesin.
    const result = await app.prisma.companyHoliday.deleteMany({ where: { id: holidayId, companyId: id } });
    if (result.count === 0) {
      return reply.status(404).send({ success: false, error: t(request, 'companies.holidayNotFound') });
    }
    await createAuditLog({
      entityType: 'company', entityId: id, action: 'holiday_delete', changes: { holidayId },
      performedBy: request.staffUser!.email, ipAddress: request.headers['x-real-ip'] as string,
    });
    reply.send({ success: true });
  });

  // Sabit tarihli tatilleri (ör. 1 Ocak, 23 Nisan) bir yıldan diğerine kopyalar.
  // Dini bayramlar gibi yıla göre kayan günler kopyalandıktan sonra elle düzeltilir.
  app.post('/:id/holidays/copy-year', {
    preValidation: guard,
    schema: {
      params: idParamsSchema,
      body: holidayCopySchema,
      tags: ['Companies'],
      summary: 'Tatil günlerini başka yıla kopyala',
      response: { 200: z.object({ success: z.literal(true), data: z.object({ created: z.number() }) }), ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    if (!(await checkAccess(request, reply, id))) return;
    const { fromYear, toYear } = request.body;
    if (fromYear === toYear) {
      return reply.status(400).send({ success: false, error: t(request, 'companies.holidayCopySameYear') });
    }
    const source = await app.prisma.companyHoliday.findMany({
      where: { companyId: id, date: { gte: new Date(Date.UTC(fromYear, 0, 1)), lt: new Date(Date.UTC(fromYear + 1, 0, 1)) } },
    });
    const data = source
      .map(h => {
        const d = h.date;
        const target = new Date(Date.UTC(toYear, d.getUTCMonth(), d.getUTCDate()));
        // 29 Şubat artık olmayan yıla taşınmaz (Date 1 Mart'a kaydırırdı).
        return target.getUTCMonth() === d.getUTCMonth() ? { companyId: id, date: target, name: h.name } : null;
      })
      .filter((x): x is { companyId: string; date: Date; name: string } => x !== null);
    const result = await app.prisma.companyHoliday.createMany({ data, skipDuplicates: true });
    await createAuditLog({
      entityType: 'company', entityId: id, action: 'holiday_copy', changes: { fromYear, toYear, created: result.count },
      performedBy: request.staffUser!.email, ipAddress: request.headers['x-real-ip'] as string,
    });
    reply.send({ success: true, data: { created: result.count } });
  });
};
