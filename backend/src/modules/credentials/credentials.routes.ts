import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { encrypt, decrypt } from '../../utils/crypto.js';
import { createAuditLog } from '../../middleware/audit.js';
import { getStaffCompanyScope, isCompanyInScope, resolveCompanyFilter } from '../../utils/staff-scope.js';

const createSchema = z.object({
  title: z.string().min(1),
  category: z.string().optional(),
  url: z.string().optional(),
  username: z.string().optional(),
  password: z.string().min(1),
  notes: z.string().optional(),
  companyId: z.string().cuid().optional(),
});

const updateSchema = createSchema.partial();

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
export const credentialRoutes: FastifyPluginAsync = async (app) => {
  // Liste — şifre/not DÖNMEZ
  app.get('/', { preHandler: [app.requireRole('admin', 'it_manager')] }, async (request, reply) => {
    const { companyId } = request.query as { companyId?: string };
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
  app.get('/:id/reveal', { preHandler: [app.requireRole('admin', 'it_manager')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const staffUser = request.staffUser!;
    const entry = await app.prisma.credentialEntry.findUnique({ where: { id } });
    if (!entry) return reply.status(404).send({ success: false, error: 'Kayıt bulunamadı' });

    // Kapsam kontrolü audit log'dan ÖNCE: reddedilen bir deneme başarılı bir
    // görüntüleme gibi loglanmamalı.
    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    if (!isCompanyInScope(scope, entry.companyId)) {
      return reply.status(403).send({ success: false, error: 'Bu kayda erişim yetkiniz yok' });
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
  app.post('/', { preHandler: [app.requireRole('admin', 'it_manager')] }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    const staffUser = request.staffUser!;
    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);

    // Kapsamlı kullanıcı global kayıt (companyId yok) oluşturamaz — oluştursaydı
    // kendi göremeyeceği bir kayıt üretmiş olurdu. companyId da kapsam içinde olmalı.
    if (scope !== null && !isCompanyInScope(scope, body.companyId)) {
      return reply.status(403).send({
        success: false,
        error: 'Yalnızca yetkili olduğunuz şirketler için şifre ekleyebilirsiniz',
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
  app.put('/:id', { preHandler: [app.requireRole('admin', 'it_manager')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateSchema.parse(request.body);
    const staffUser = request.staffUser!;

    const existing = await app.prisma.credentialEntry.findUnique({
      where: { id },
      select: { id: true, companyId: true },
    });
    if (!existing) return reply.status(404).send({ success: false, error: 'Kayıt bulunamadı' });

    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);

    // MEVCUT kayıt kapsam içinde mi? Değilse dokunamaz.
    if (!isCompanyInScope(scope, existing.companyId)) {
      return reply.status(403).send({ success: false, error: 'Bu kayda erişim yetkiniz yok' });
    }

    // HEDEF şirket de kapsam içinde mi? Bu kontrol olmadan kapsamlı bir kullanıcı
    // kaydı kendi kapsamına taşıyıp okuyabilir ya da erişilemez hale getirebilir.
    if (body.companyId !== undefined && scope !== null && !isCompanyInScope(scope, body.companyId)) {
      return reply.status(403).send({
        success: false,
        error: 'Kaydı yetkili olmadığınız bir şirkete taşıyamazsınız',
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
  app.delete('/:id', { preHandler: [app.requireRole('admin', 'it_manager')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const staffUser = request.staffUser!;
    const existing = await app.prisma.credentialEntry.findUnique({
      where: { id },
      select: { id: true, companyId: true },
    });
    if (!existing) return reply.status(404).send({ success: false, error: 'Kayıt bulunamadı' });

    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    if (!isCompanyInScope(scope, existing.companyId)) {
      return reply.status(403).send({ success: false, error: 'Bu kayda erişim yetkiniz yok' });
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
