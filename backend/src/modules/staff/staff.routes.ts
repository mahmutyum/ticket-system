import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { StaffRole } from '@prisma/client';
import bcrypt from 'bcrypt';
import { createAuditLog } from '../../middleware/audit.js';
import { invalidateAccessTokens } from '../../plugins/auth.js';
import { strongPassword } from '../../utils/validation.js';

const staffCreateSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
  password: strongPassword,
  role: z.nativeEnum(StaffRole),
  department: z.string().optional(),
  phone: z.string().optional(),
});

const staffUpdateSchema = z.object({
  fullName: z.string().min(1).optional(),
  role: z.nativeEnum(StaffRole).optional(),
  department: z.string().optional(),
  phone: z.string().optional(),
  isActive: z.boolean().optional(),
  password: strongPassword.optional(),
});
const idParamsSchema = z.object({ id: z.string().min(1).max(128) });
const staffQuerySchema = z.object({ companyId: z.string().cuid().optional() });
const staffCompaniesSchema = z.object({ companyIds: z.array(z.string().cuid()).max(100) });

/**
 * Bir personelin TÜM oturumlarını kapatır.
 *
 * Oturumlar `refresh:<staffId>:<sid>` altında tutulur (çoklu cihaz), bu yüzden
 * tek bir DEL yetmez — desen taranır. `scanStream` KEYS yerine kullanılır:
 * KEYS tüm Redis'i bloklar.
 */
async function deleteAllSessions(app: any, staffId: string): Promise<void> {
  const pattern = `refresh:${staffId}:*`;
  const stream = app.redis.scanStream({ match: pattern, count: 100 });
  for await (const keys of stream as AsyncIterable<string[]>) {
    if (keys.length) await app.redis.del(...keys);
  }
}

export const staffRoutes: FastifyPluginAsync = async (app) => {
  // List staff (optionally filtered by company assignment)
  app.get('/', {
    preValidation: [app.authenticate],
    schema: { querystring: staffQuerySchema, tags: ['Staff'], summary: 'Personel listesini getir' },
  }, async (request, reply) => {
    const { companyId } = request.query as { companyId?: string };

    const where: any = {};
    if (companyId) {
      // Bu şirkete erişebilen personel: o şirkete atanmış olanlar VEYA admin
      // (rolü gereği sınırsız).
      //
      // Buradaki liste kapsam modelini yansıtmak ZORUNDA. Önceden it_manager da
      // "hepsini görür" sayılıyor ve atamasız it_staff sınırsız kabul ediliyordu;
      // it_manager şirket kapsamına alınıp fail-closed'a geçildikten sonra bu iki
      // varsayım da yanlış hale geldi. Tek doğruluk kaynağı utils/staff-scope.ts.
      where.OR = [
        { assignedCompanies: { some: { companyId } } },
        { role: StaffRole.admin },
      ];
    }

    const staff = await app.prisma.staff.findMany({
      where: { ...where, isActive: true },
      orderBy: { fullName: 'asc' },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        department: true,
        phone: true,
        isActive: true,
        avatarUrl: true,
        createdAt: true,
        _count: { select: { assignedTickets: true } },
        assignedCompanies: {
          select: { companyId: true, company: { select: { name: true } } },
        },
      },
    });
    reply.send({ success: true, data: staff });
  });

  // Create staff
  app.post('/', {
    preValidation: [app.requireRole('admin')],
    schema: { body: staffCreateSchema, tags: ['Staff'], summary: 'Personel oluştur' },
  }, async (request, reply) => {
    const body = staffCreateSchema.parse(request.body);
    const passwordHash = await bcrypt.hash(body.password, 12);

    const staff = await app.prisma.staff.create({
      data: {
        email: body.email,
        fullName: body.fullName,
        passwordHash,
        role: body.role,
        department: body.department,
        phone: body.phone,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        department: true,
      },
    });

    await createAuditLog({
      entityType: 'staff',
      entityId: staff.id,
      action: 'create',
      changes: { email: body.email, role: body.role },
      performedBy: request.staffUser!.email,
      ipAddress: request.headers['x-real-ip'] as string,
    });

    reply.status(201).send({ success: true, data: staff });
  });

  // Update staff
  app.put('/:id', {
    preValidation: [app.requireRole('admin')],
    schema: { params: idParamsSchema, body: staffUpdateSchema, tags: ['Staff'], summary: 'Personel güncelle' },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = staffUpdateSchema.parse(request.body);

    const before = await app.prisma.staff.findUnique({
      where: { id },
      select: { role: true, isActive: true },
    });
    if (!before) return reply.status(404).send({ success: false, error: 'Personel bulunamadı' });

    const updateData: any = { ...body };
    if (body.password) {
      updateData.passwordHash = await bcrypt.hash(body.password, 12);
      delete updateData.password;

      // Şifre değişti → TÜM oturumlar kapanır (hangi cihazlar olduğu bilinmez).
      await deleteAllSessions(app, id);
    }

    const staff = await app.prisma.staff.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        department: true,
        phone: true,
        isActive: true,
      },
    });

    // ROL veya AKTİFLİK değiştiyse mevcut access token'ları geçersiz kıl.
    //
    // authenticate JWT'yi DB'ye bakmadan kabul eder; bu olmadan rolü düşürülen
    // biri access token'ı dolana kadar (15 dk) eski rolüyle çalışmaya devam
    // ederdi. Geçersizleştirme kullanıcıyı DÜŞÜRMEZ: istemci 401 alır, otomatik
    // refresh yapar, refresh rolü DB'den okur ve güncel rolle devam eder.
    const roleChanged = body.role !== undefined && body.role !== before.role;
    const deactivated = body.isActive === false && before.isActive;

    if (roleChanged || deactivated) {
      await invalidateAccessTokens(app.redis, id);
    }
    if (deactivated) {
      // Pasife alındı → refresh de çalışmasın (zaten isActive kontrolü var,
      // ama oturum kaydını da temizle).
      await deleteAllSessions(app, id);
    }

    const auditChanges: Record<string, any> = { ...body };
    delete auditChanges.password;
    await createAuditLog({ entityType: 'staff', entityId: id, action: 'update', changes: auditChanges, performedBy: request.staffUser!.email, ipAddress: request.headers['x-real-ip'] as string });

    reply.send({ success: true, data: staff });
  });

  // Deactivate staff
  app.delete('/:id', {
    preValidation: [app.requireRole('admin')],
    schema: { params: idParamsSchema, tags: ['Staff'], summary: 'Personeli pasifleştir' },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    await app.prisma.staff.update({
      where: { id },
      data: { isActive: false },
    });

    await createAuditLog({ entityType: 'staff', entityId: id, action: 'deactivate', performedBy: request.staffUser!.email, ipAddress: request.headers['x-real-ip'] as string });

    // Access token'ları anında öldür + tüm oturumları kapat.
    await invalidateAccessTokens(app.redis, id);
    await deleteAllSessions(app, id);

    reply.send({ success: true });
  });

  // Update staff company assignments
  //
  // YALNIZCA admin. Daha önce it_manager'a da açıktı ve handler hedefin
  // çağıranın kendisi olup olmadığına bakmıyordu: kapsamlı bir it_manager
  // PUT /staff/<kendi-id>/companies ile tüm şirketleri kendine atayıp
  // sınırsız erişim kazanabiliyordu (kapsam her istekte DB'den okunduğu için
  // anında etkili olurdu). Şirket ataması bir yetki kararıdır — admin'de kalır.
  app.put('/:id/companies', {
    preValidation: [app.requireRole('admin')],
    schema: { params: idParamsSchema, body: staffCompaniesSchema, tags: ['Staff'], summary: 'Personel şirket kapsamını güncelle' },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = staffCompaniesSchema.parse(request.body);

    // Delete existing assignments and recreate
    await app.prisma.staffCompany.deleteMany({ where: { staffId: id } });

    if (body.companyIds.length > 0) {
      await app.prisma.staffCompany.createMany({
        data: body.companyIds.map(companyId => ({ staffId: id, companyId })),
      });
    }

    await createAuditLog({
      entityType: 'staff',
      entityId: id,
      action: 'company_assignment',
      changes: { companyIds: body.companyIds },
      performedBy: request.staffUser!.email,
      ipAddress: request.headers['x-real-ip'] as string,
    });

    reply.send({ success: true });
  });
};
