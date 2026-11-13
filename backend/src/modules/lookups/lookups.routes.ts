import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { StatusClass } from '@prisma/client';
import { createAuditLog } from '../../middleware/audit.js';
import { commonErrorResponses } from '../../utils/api-schema.js';
import { t } from '../../i18n/index.js';
import { entriesOf, invalidateDictionaries, loadDictionaries } from '../../services/lookups.js';

/**
 * Sözlük uçları (v1.3).
 *
 * GET /lookups            → personel: tüm sözlük girdileri (pasifler yalnızca admin'de)
 * GET /public             → talep eden: yalnızca AKTİF girdiler (portal rozetleri:
 *                            etiket + renk tokenı; dil istemci tarafında seçilir)
 * POST /:kind             → girdi ekler (admin)
 * PUT /:kind/:key         → girdi günceller (key değişmez; pasifleştirmede
 *                            "sınıf başına en az bir aktif" korunur)
 * POST /:kind/:key/merge  → kullanım satırlarını başka anahtara taşır, kaynağı
 *                            pasifleştirir (yol haritasındaki "birleştir")
 *
 * Dinamik SQL: tablo/kolon adları sunucu tarafındaki SABİT beyaz listelerden
 * gelir; değerler parametrelidir — injection yüzeyi yoktur.
 */

const KINDS = ['ticketStatuses', 'priorities', 'taskStatuses', 'onsiteTypes', 'onsiteStatuses', 'companyTypes'] as const;
type Kind = (typeof KINDS)[number];

const KIND_TO_TABLE: Record<Kind, string> = {
  ticketStatuses: 'dict_ticket_statuses',
  priorities: 'dict_priorities',
  taskStatuses: 'dict_task_statuses',
  onsiteTypes: 'dict_onsite_types',
  onsiteStatuses: 'dict_onsite_statuses',
  companyTypes: 'dict_company_types',
};

/** Birleştirmede kullanım satırlarının taşınacağı referans tablolar. */
const KIND_REFERENCES: Record<Kind, Array<{ table: string; column: string }>> = {
  ticketStatuses: [{ table: 'tickets', column: 'status' }],
  priorities: [
    { table: 'tickets', column: 'priority' },
    { table: 'tasks', column: 'priority' },
    { table: 'ticket_templates', column: 'priority' },
  ],
  taskStatuses: [{ table: 'tasks', column: 'status' }],
  onsiteTypes: [{ table: 'onsite_support', column: 'type' }],
  onsiteStatuses: [{ table: 'onsite_support', column: 'status' }],
  companyTypes: [{ table: 'companies', column: 'group_type' }],
};

const entrySchema = z.object({
  key: z.string(),
  labelTr: z.string(),
  labelEn: z.string(),
  color: z.string().nullable(),
  sortOrder: z.number().int(),
  statusClass: z.string().nullable().optional(),
  weight: z.number().int().nullable().optional(),
  isActive: z.boolean(),
  isSystem: z.boolean(),
});

const kindParams = z.object({ kind: z.enum(KINDS) });
const keyParams = z.object({ kind: z.enum(KINDS), key: z.string().min(1).max(64) });

const upsertBody = z.object({
  key: z.string().regex(/^[a-z0-9_]{1,64}$/).optional(),
  labelTr: z.string().trim().min(1).max(120),
  labelEn: z.string().trim().min(1).max(120),
  color: z.string().trim().max(32).nullable().default(null),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  statusClass: z.nativeEnum(StatusClass).optional(),
  weight: z.number().int().min(1).max(99).optional(),
  isActive: z.boolean().default(true),
});

const mergeBody = z.object({ targetKey: z.string().min(1).max(64) });

/** Public görünüm: yalnızca aktif girdiler, panel alanları olmadan. */
function publicEntries(kind: Kind) {
  return entriesOf(kind)
    .filter((entry) => entry.isActive)
    .map((entry) => ({
      key: entry.key,
      labelTr: entry.labelTr,
      labelEn: entry.labelEn,
      color: entry.color,
      sortOrder: entry.sortOrder,
      statusClass: entry.statusClass ?? null,
    }));
}

export const lookupsRoutes: FastifyPluginAsyncZod = async (app) => {
  const admin = [app.requireRole('admin')];

  app.get('/', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Lookups'],
      summary: 'Sözlük girdilerini tür bazında listeler',
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.record(z.enum(KINDS), z.array(entrySchema)),
        }),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    const isAdmin = request.staffUser!.role === 'admin';
    const data: Record<string, unknown> = {};
    for (const kind of KINDS) {
      const entries = entriesOf(kind);
      data[kind] = isAdmin ? entries : entries.filter((entry) => entry.isActive);
    }
    reply.send({ success: true, data });
  });

  app.get('/public', {
    schema: {
      tags: ['Lookups'],
      summary: 'Aktif sözlük girdileri (public portal rozetleri için)',
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.record(z.string(), z.array(z.object({
            key: z.string(), labelTr: z.string(), labelEn: z.string(),
            color: z.string().nullable(), sortOrder: z.number().int(),
            statusClass: z.string().nullable(),
          }))),
        }),
      },
    },
  }, async (_request, reply) => {
    reply.send({
      success: true,
      data: {
        ticketStatuses: publicEntries('ticketStatuses'),
        priorities: publicEntries('priorities'),
      },
    });
  });

  app.post('/:kind', {
    preValidation: admin,
    schema: {
      tags: ['Lookups'],
      summary: 'Sözlük girdisi ekler',
      params: kindParams,
      body: upsertBody,
      response: {
        200: z.object({ success: z.literal(true) }),
        409: z.object({ success: z.literal(false), error: z.string() }),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    const { kind } = request.params;
    const body = request.body;
    if (!body.key) return reply.status(400).send({ success: false, error: t(request, 'lookups.key_required') });

    const table = KIND_TO_TABLE[kind];
    const exists = await app.prisma.$queryRawUnsafe<Array<{ key: string }>>(
      `SELECT key FROM ${table} WHERE key = $1 LIMIT 1`, body.key,
    );
    if (exists.length > 0) {
      return reply.status(409).send({ success: false, error: t(request, 'lookups.key_exists') });
    }

    const hasClass = kind === 'ticketStatuses';
    const hasWeight = kind === 'priorities';
    const columns = ['key', 'label_tr', 'label_en', 'color', 'sort_order',
      ...(hasClass ? ['status_class'] : []), ...(hasWeight ? ['weight'] : []),
      'is_active', 'is_system'];
    const values: unknown[] = [body.key, body.labelTr, body.labelEn, body.color, body.sortOrder,
      ...(hasClass ? [body.statusClass] : []), ...(hasWeight ? [body.weight] : []),
      body.isActive, false];
    const placeholders = columns
      .map((column, i) => (column === 'status_class' ? `$${i + 1}::"StatusClass"` : `$${i + 1}`))
      .join(', ');
    // created_at/updated_at SQL now() ile verilir (updated_at NOT NULL,
    // default yoktur — boş satır NOT NULL ihlaline yol açar).
    await app.prisma.$executeRawUnsafe(
      `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(', ')}, "created_at", "updated_at") VALUES (${placeholders}, now(), now())`,
      ...values,
    );

    await invalidateDictionaries();
    await createAuditLog({
      entityType: 'lookup', entityId: `${kind}:${body.key}`, action: 'create',
      changes: { labelTr: body.labelTr, labelEn: body.labelEn, statusClass: body.statusClass ?? null },
      performedBy: request.staffUser!.email, ipAddress: request.ip,
    });
    reply.send({ success: true });
  });

  app.put('/:kind/:key', {
    preValidation: admin,
    schema: {
      tags: ['Lookups'],
      summary: 'Sözlük girdisini günceller',
      params: keyParams,
      body: upsertBody,
      response: { 200: z.object({ success: z.literal(true) }), ...commonErrorResponses },
    },
  }, async (request, reply) => {
    const { kind, key } = request.params;
    const body = request.body;

    const entry = entriesOf(kind).find((e) => e.key === key);
    if (!entry) return reply.status(404).send({ success: false, error: t(request, 'lookups.not_found') });

    // Pasifleştirme güvenliği: ticket durumunda her sınıfta en az bir AKTİF durum
    // kalmalı — aksi hâlde sınıf davranışı (SLA duraklatma vb.) boş kalır.
    if (kind === 'ticketStatuses' && entry.isActive && !body.isActive) {
      const cls = entry.statusClass;
      if (!cls) return reply.status(400).send({ success: false, error: t(request, 'lookups.missing_class') });
      const sameClassActive = entriesOf(kind).filter((e) => e.isActive && e.statusClass === cls);
      if (sameClassActive.length <= 1) {
        return reply.status(400).send({ success: false, error: t(request, 'lookups.last_in_class') });
      }
    }

    const table = KIND_TO_TABLE[kind];
    const setFragments: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown, cast?: string) => {
      values.push(value);
      setFragments.push(`"${column}" = $${values.length}${cast ? `::"${cast}"` : ''}`);
    };
    add('label_tr', body.labelTr);
    add('label_en', body.labelEn);
    add('color', body.color);
    add('sort_order', body.sortOrder);
    add('is_active', body.isActive);
    if (kind === 'ticketStatuses') add('status_class', body.statusClass ?? null, 'StatusClass');
    if (kind === 'priorities') add('weight', body.weight ?? null);
    add('updated_at', new Date());
    values.push(key);
    await app.prisma.$executeRawUnsafe(
      `UPDATE ${table} SET ${setFragments.join(', ')} WHERE "key" = $${values.length}`,
      ...values,
    );

    await invalidateDictionaries();
    await createAuditLog({
      entityType: 'lookup', entityId: `${kind}:${key}`, action: 'update',
      changes: { labelTr: body.labelTr, labelEn: body.labelEn, isActive: body.isActive, statusClass: body.statusClass ?? null },
      performedBy: request.staffUser!.email, ipAddress: request.ip,
    });
    reply.send({ success: true });
  });

  app.post('/:kind/:key/merge', {
    preValidation: admin,
    schema: {
      tags: ['Lookups'],
      summary: 'Girdiyi başka bir anahtarla birleştirir (kullanımları taşır)',
      params: keyParams,
      body: mergeBody,
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ moved: z.number().int() }) }),
        ...commonErrorResponses,
      },
    },
  }, async (request, reply) => {
    const { kind, key } = request.params;
    const { targetKey } = request.body;
    if (key === targetKey) return reply.status(400).send({ success: false, error: t(request, 'lookups.merge_self') });

    const table = KIND_TO_TABLE[kind];
    const target = entriesOf(kind).find((e) => e.key === targetKey && e.isActive);
    if (!target) return reply.status(400).send({ success: false, error: t(request, 'lookups.merge_target_missing') });
    const source = entriesOf(kind).find((e) => e.key === key);
    if (!source) return reply.status(404).send({ success: false, error: t(request, 'lookups.not_found') });

    let moved = 0;
    for (const ref of KIND_REFERENCES[kind]) {
      const result = await app.prisma.$executeRawUnsafe(
        `UPDATE ${ref.table} SET ${ref.column} = $1 WHERE ${ref.column} = $2`,
        targetKey, key,
      );
      moved += result;
    }
    await app.prisma.$executeRawUnsafe(
      `UPDATE ${table} SET "is_active" = false, "updated_at" = now() WHERE "key" = $1`,
      key,
    );

    await invalidateDictionaries();
    await createAuditLog({
      entityType: 'lookup', entityId: `${kind}:${key}`, action: 'merge',
      changes: { targetKey, movedRows: moved },
      performedBy: request.staffUser!.email, ipAddress: request.ip,
    });
    reply.send({ success: true, data: { moved } });
  });

  // İlk erişimde DB sözlüklerini yükle (server.ts boot'ta da çağırır).
  app.addHook('onReady', async () => {
    await loadDictionaries();
  });
};
