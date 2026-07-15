import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { encrypt, decrypt } from '../../utils/crypto.js';
import { createAuditLog } from '../../middleware/audit.js';

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

export const credentialRoutes: FastifyPluginAsync = async (app) => {
  // Liste — şifre/not DÖNMEZ
  app.get('/', { preHandler: [app.requireRole('admin')] }, async (request, reply) => {
    const { companyId } = request.query as { companyId?: string };
    const entries = await app.prisma.credentialEntry.findMany({
      where: companyId ? { companyId } : {},
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
  app.get('/:id/reveal', { preHandler: [app.requireRole('admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = await app.prisma.credentialEntry.findUnique({ where: { id } });
    if (!entry) return reply.status(404).send({ success: false, error: 'Kayıt bulunamadı' });

    await createAuditLog({
      entityType: 'credential',
      entityId: id,
      action: 'credential_reveal',
      changes: { title: entry.title },
      performedBy: request.staffUser!.email,
      ipAddress: request.headers['x-real-ip'] as string,
    });

    reply.send({
      success: true,
      data: { password: decrypt(entry.passwordEnc), notes: entry.notesEnc ? decrypt(entry.notesEnc) : null },
    });
  });

  // Oluştur
  app.post('/', { preHandler: [app.requireRole('admin')] }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    const entry = await app.prisma.credentialEntry.create({
      data: {
        title: body.title,
        category: body.category,
        url: body.url,
        username: body.username,
        passwordEnc: encrypt(body.password),
        notesEnc: body.notes ? encrypt(body.notes) : undefined,
        companyId: body.companyId,
        createdById: request.staffUser!.id,
      },
      select: { id: true, title: true },
    });
    await createAuditLog({
      entityType: 'credential', entityId: entry.id, action: 'create',
      changes: { title: body.title }, performedBy: request.staffUser!.email,
      ipAddress: request.headers['x-real-ip'] as string,
    });
    reply.status(201).send({ success: true, data: entry });
  });

  // Güncelle
  app.put('/:id', { preHandler: [app.requireRole('admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateSchema.parse(request.body);
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
      changes: { title: entry.title }, performedBy: request.staffUser!.email,
      ipAddress: request.headers['x-real-ip'] as string,
    });
    reply.send({ success: true, data: entry });
  });

  // Sil
  app.delete('/:id', { preHandler: [app.requireRole('admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await app.prisma.credentialEntry.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return reply.status(404).send({ success: false, error: 'Kayıt bulunamadı' });
    await app.prisma.credentialEntry.delete({ where: { id } });
    await createAuditLog({
      entityType: 'credential', entityId: id, action: 'delete',
      changes: {}, performedBy: request.staffUser!.email,
      ipAddress: request.headers['x-real-ip'] as string,
    });
    reply.send({ success: true });
  });
};
