import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { createAuditLog } from '../../middleware/audit.js';
import { commonErrorResponses, errorResponseSchema, successResponseSchema } from '../../utils/api-schema.js';
import { csvRecords } from '../../utils/csv-parse.js';
import { getStaffCompanyScope, isCompanyInScope } from '../../utils/staff-scope.js';
import { t } from '../../i18n/index.js';

/**
 * Varlık (envanter) kaydı. Şirket verisidir: kapsam kuralları uygulanır; okuma tüm
 * personel, yazma admin + kapsamındaki it_manager.
 */

const idParams = z.object({ id: z.string().min(1).max(128) });
const MAX_IMPORT_ROWS = 5000;

const assetBody = z.object({
  companyId: z.string().min(1).max(128),
  tag: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  assetType: z.string().trim().min(1).max(64),
  serialNumber: z.string().trim().max(128).nullish(),
  locationId: z.string().max(128).nullish(),
  assignedToEmail: z.string().trim().toLowerCase().email().max(254).nullish().or(z.literal('')),
  notes: z.string().trim().max(2000).nullish(),
  isActive: z.boolean().default(true),
});

const assetSchema = z.object({
  id: z.string(), companyId: z.string(), tag: z.string(), name: z.string(), assetType: z.string(),
  serialNumber: z.string().nullable(), locationId: z.string().nullable(), assignedToEmail: z.string().nullable(),
  notes: z.string().nullable(), isActive: z.boolean(), createdAt: z.date(), updatedAt: z.date(),
  company: z.object({ name: z.string() }), location: z.object({ name: z.string() }).nullable(),
  _count: z.object({ tickets: z.number() }),
});

const include = { company: { select: { name: true } }, location: { select: { name: true } }, _count: { select: { tickets: true } } } as const;

export const assetRoutes: FastifyPluginAsyncZod = async (app) => {
  const writers = [app.requireRole('admin', 'it_manager')];
  const scopeOf = (request: FastifyRequest) => getStaffCompanyScope(app.prisma, request.staffUser!.id, request.staffUser!.role);

  async function inScope(request: FastifyRequest, reply: FastifyReply, companyId: string): Promise<boolean> {
    if (isCompanyInScope(await scopeOf(request), companyId)) return true;
    reply.status(403).send({ success: false, error: t(request, 'assets.forbidden') });
    return false;
  }

  async function validLocation(request: FastifyRequest, reply: FastifyReply, companyId: string, locationId?: string | null) {
    if (!locationId) return true;
    const location = await app.prisma.location.findFirst({ where: { id: locationId, companyId }, select: { id: true } });
    if (!location) reply.status(400).send({ success: false, error: t(request, 'assets.invalid_location') });
    return !!location;
  }

  const toData = (body: z.infer<typeof assetBody>) => ({
    ...body,
    serialNumber: body.serialNumber || null,
    locationId: body.locationId || null,
    assignedToEmail: body.assignedToEmail || null,
    notes: body.notes || null,
  });

  app.get('/', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Assets'],
      summary: 'Varlıkları listeler',
      querystring: z.object({
        companyId: z.string().max(128).optional(),
        q: z.string().max(200).optional(),
        assignedToEmail: z.string().max(254).optional(),
      }),
      response: { 200: z.object({ success: z.literal(true), data: z.array(assetSchema) }), ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const scope = await scopeOf(request);
    const { companyId, q, assignedToEmail } = request.query;
    // companyId filtresi kapsamla KESİŞTİRİLİR.
    if (companyId && !isCompanyInScope(scope, companyId)) return reply.send({ success: true, data: [] });
    const where: Prisma.AssetWhereInput = {
      ...(companyId ? { companyId } : scope ? { companyId: { in: scope } } : {}),
      ...(assignedToEmail ? { assignedToEmail: assignedToEmail.toLowerCase() } : {}),
      ...(q && q.trim().length >= 2
        ? { OR: ['tag', 'name', 'serialNumber', 'assignedToEmail', 'assetType'].map(f => ({ [f]: { contains: q.trim(), mode: 'insensitive' } })) }
        : {}),
    };
    const assets = await app.prisma.asset.findMany({ where, include, orderBy: { tag: 'asc' }, take: 500 });
    reply.send({ success: true, data: assets });
  });

  app.get('/:id', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Assets'],
      summary: 'Varlık ve ticket geçmişi',
      params: idParams,
      response: {
        200: z.object({
          success: z.literal(true),
          data: assetSchema.extend({
            tickets: z.array(z.object({ id: z.string(), ticketNumber: z.string(), subject: z.string(), status: z.string(), createdAt: z.date() })),
          }),
        }),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    const asset = await app.prisma.asset.findUnique({
      where: { id: request.params.id },
      include: {
        ...include,
        tickets: { select: { id: true, ticketNumber: true, subject: true, status: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!asset || !isCompanyInScope(await scopeOf(request), asset.companyId)) {
      return reply.status(404).send({ success: false, error: t(request, 'assets.not_found') });
    }
    reply.send({ success: true, data: asset });
  });

  app.post('/', {
    preValidation: writers,
    schema: { tags: ['Assets'], summary: 'Varlık ekler', body: assetBody, response: { 200: z.object({ success: z.literal(true), data: assetSchema }), ...commonErrorResponses, 409: errorResponseSchema } },
  }, async (request, reply) => {
    const body = request.body;
    if (!(await inScope(request, reply, body.companyId)) || !(await validLocation(request, reply, body.companyId, body.locationId))) return;
    try {
      const asset = await app.prisma.asset.create({ data: toData(body), include });
      await createAuditLog({ entityType: 'asset', entityId: asset.id, action: 'create', changes: { tag: body.tag, companyId: body.companyId }, performedBy: request.staffUser!.email, ipAddress: request.ip });
      reply.send({ success: true, data: asset });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.status(409).send({ success: false, error: t(request, 'assets.tag_exists') });
      }
      throw err;
    }
  });

  app.put('/:id', {
    preValidation: writers,
    schema: { tags: ['Assets'], summary: 'Varlık günceller', params: idParams, body: assetBody, response: { 200: z.object({ success: z.literal(true), data: assetSchema }), ...commonErrorResponses, 409: errorResponseSchema } },
  }, async (request, reply) => {
    const existing = await app.prisma.asset.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.status(404).send({ success: false, error: t(request, 'assets.not_found') });
    const body = request.body;
    // Şirket değiştirilemez: bağlı ticket'lar eski şirkete ait olurdu.
    if (body.companyId !== existing.companyId) return reply.status(400).send({ success: false, error: t(request, 'assets.company_immutable') });
    if (!(await inScope(request, reply, existing.companyId)) || !(await validLocation(request, reply, existing.companyId, body.locationId))) return;
    try {
      const asset = await app.prisma.asset.update({ where: { id: existing.id }, data: toData(body), include });
      await createAuditLog({ entityType: 'asset', entityId: asset.id, action: 'update', changes: { tag: body.tag, isActive: body.isActive }, performedBy: request.staffUser!.email, ipAddress: request.ip });
      reply.send({ success: true, data: asset });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.status(409).send({ success: false, error: t(request, 'assets.tag_exists') });
      }
      throw err;
    }
  });

  app.delete('/:id', {
    preValidation: writers,
    schema: { tags: ['Assets'], summary: 'Varlık siler (ticket bağlantıları kalkar)', params: idParams, response: { 200: successResponseSchema, ...commonErrorResponses } },
  }, async (request, reply) => {
    const existing = await app.prisma.asset.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.status(404).send({ success: false, error: t(request, 'assets.not_found') });
    if (!(await inScope(request, reply, existing.companyId))) return;
    await app.prisma.asset.delete({ where: { id: existing.id } });
    await createAuditLog({ entityType: 'asset', entityId: existing.id, action: 'delete', changes: { tag: existing.tag }, performedBy: request.staffUser!.email, ipAddress: request.ip });
    reply.send({ success: true });
  });

  // CSV içe aktarma — etiket şirket içinde anahtardır (varsa güncellenir, yoksa eklenir).
  // Sütunlar: tag, name, type, serial, location (lokasyon adı), assigned_to (e-posta), notes.
  app.post('/import', {
    preValidation: writers,
    schema: {
      tags: ['Assets'],
      summary: 'CSV ile varlık içe aktarır',
      body: z.object({ companyId: z.string().min(1).max(128), csv: z.string().min(1).max(5_000_000) }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({ created: z.number(), updated: z.number(), errors: z.array(z.object({ line: z.number(), message: z.string() })) }),
        }),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    const { companyId, csv } = request.body;
    if (!(await inScope(request, reply, companyId))) return;
    const records = csvRecords(csv);
    if (records.length > MAX_IMPORT_ROWS) {
      return reply.status(400).send({ success: false, error: t(request, 'assets.import_too_large') });
    }
    const locations = await app.prisma.location.findMany({ where: { companyId }, select: { id: true, name: true } });
    const locationByName = new Map(locations.map(l => [l.name.trim().toLowerCase(), l.id]));
    const pick = (v: Record<string, string>, ...keys: string[]) => keys.map(k => v[k]).find(x => x !== undefined && x !== '') ?? '';

    let created = 0;
    let updated = 0;
    const errors: Array<{ line: number; message: string }> = [];
    for (const { line, values } of records) {
      const locationName = pick(values, 'location', 'lokasyon');
      const parsed = assetBody.safeParse({
        companyId,
        tag: pick(values, 'tag', 'etiket'),
        name: pick(values, 'name', 'ad'),
        assetType: pick(values, 'type', 'tür', 'tur', 'asset_type'),
        serialNumber: pick(values, 'serial', 'serial_number', 'seri') || null,
        locationId: locationName ? locationByName.get(locationName.toLowerCase()) ?? '__missing__' : null,
        assignedToEmail: pick(values, 'assigned_to', 'email', 'zimmet') || null,
        notes: pick(values, 'notes', 'not') || null,
      });
      if (!parsed.success) {
        errors.push({ line, message: parsed.error.issues.map(i => i.path.join('.')).join(', ') });
        continue;
      }
      if (parsed.data.locationId === '__missing__') {
        errors.push({ line, message: `location: ${locationName}` });
        continue;
      }
      const data = toData(parsed.data);
      const existing = await app.prisma.asset.findUnique({ where: { companyId_tag: { companyId, tag: data.tag } }, select: { id: true } });
      if (existing) {
        await app.prisma.asset.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await app.prisma.asset.create({ data });
        created++;
      }
    }
    await createAuditLog({ entityType: 'asset', entityId: companyId, action: 'import', changes: { created, updated, errors: errors.length }, performedBy: request.staffUser!.email, ipAddress: request.ip });
    reply.send({ success: true, data: { created, updated, errors: errors.slice(0, 100) } });
  });
};
