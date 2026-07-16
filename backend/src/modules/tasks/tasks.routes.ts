import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Priority, TaskStatus } from '@prisma/client';
import { queueEmail } from '../../jobs/queue.js';
import { config } from '../../config/index.js';
import { broadcastToStaff } from '../../services/sse.service.js';
import { createAuditLog } from '../../middleware/audit.js';
import { getStaffCompanyScope, isCompanyInScope } from '../../utils/staff-scope.js';
import { requiredText, LIMITS } from '../../utils/validation.js';

/**
 * Görev kapsamı — `Task`'ta `companyId` yoktur, şirkete `location → company`
 * üzerinden iki adımda ulaşılır ve `locationId` null olabilir.
 *
 * Kapsamlı bir kullanıcı (it_manager) şunları görür:
 *  - şirketlerinden birine ait lokasyondaki görevler,
 *  - kendisine atanmış görevler,
 *  - kendi oluşturduğu görevler.
 *
 * Son iki madde olmasa yönetici kendi görevinden kilitlenirdi (ör. lokasyonu
 * sonradan null'lanmış bir görev).
 */
function taskScopeWhere(scope: string[] | null, staffId: string): Record<string, any> {
  if (scope === null) return {}; // admin
  return {
    OR: [
      { location: { companyId: { in: scope } } },
      { assignees: { some: { staffId } } },
      { createdById: staffId },
    ],
  };
}

const taskCreateSchema = z.object({
  title: requiredText({ ...LIMITS.taskTitle, label: 'Başlık' }),
  description: requiredText({ ...LIMITS.taskDescription, label: 'Açıklama' }),
  priority: z.nativeEnum(Priority).default(Priority.medium),
  dueDate: z.string().datetime().optional().nullable(),
  assigneeIds: z.array(z.string().cuid()).min(1),
  locationId: z.string().cuid(),
});

const taskUpdateSchema = z.object({
  title: requiredText({ ...LIMITS.taskTitle, label: 'Başlık' }).optional(),
  description: requiredText({ ...LIMITS.taskDescription, label: 'Açıklama' }).optional(),
  priority: z.nativeEnum(Priority).optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  dueDate: z.string().datetime().optional().nullable(),
  assigneeIds: z.array(z.string().cuid()).optional(),
  locationId: z.string().cuid().optional().nullable(),
});

const commentSchema = z.object({
  content: requiredText({ ...LIMITS.taskComment, label: 'Yorum' }),
});
const idParamsSchema = z.object({ id: z.string().min(1).max(128) });
const taskListQuerySchema = z.object({
  status: z.nativeEnum(TaskStatus).optional(),
  mine: z.literal('1').optional(),
  scope: z.enum(['created', 'assigned', 'all']).optional(),
});
const taskStatusSchema = z.object({ status: z.nativeEnum(TaskStatus) });

const TASK_SELECT = {
  id: true,
  title: true,
  description: true,
  priority: true,
  status: true,
  dueDate: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, fullName: true, email: true } },
  location: {
    select: {
      id: true,
      name: true,
      company: { select: { id: true, name: true } },
    },
  },
  assignees: {
    select: {
      assignedAt: true,
      staff: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
    },
  },
  _count: { select: { comments: true } },
} as const;

export const taskRoutes: FastifyPluginAsync = async (app) => {
  // List tasks — admin/manager: all, staff: only assigned
  app.get('/', { preValidation: [app.authenticate], schema: { querystring: taskListQuerySchema, tags: ['Tasks'], summary: 'Görevleri listele' } }, async (request, reply) => {
    const staffUser = request.staffUser!;
    const q = taskListQuerySchema.parse(request.query ?? {});

    const where: any = {};
    if (q.status) where.status = q.status;

    const isManager = staffUser.role === 'admin' || staffUser.role === 'it_manager';
    if (!isManager || q.mine === '1' || q.scope === 'assigned') {
      where.assignees = { some: { staffId: staffUser.id } };
    } else if (q.scope === 'created') {
      where.createdById = staffUser.id;
    } else {
      // Yönetici "tümü" görünümü — şirket kapsamıyla sınırlanır. Daha önce burada
      // hiçbir kısıt yoktu ve it_manager tüm şirketlerin görevlerini görüyordu.
      const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
      Object.assign(where, taskScopeWhere(scope, staffUser.id));
    }

    const tasks = await app.prisma.task.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      select: TASK_SELECT,
    });

    reply.send({ success: true, data: tasks });
  });

  // Get single task with comments
  app.get('/:id', { preValidation: [app.authenticate], schema: { params: idParamsSchema, tags: ['Tasks'], summary: 'Görev detayını getir' } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const staffUser = request.staffUser!;

    const task = await app.prisma.task.findUnique({
      where: { id },
      select: {
        ...TASK_SELECT,
        comments: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            content: true,
            createdAt: true,
            createdBy: { select: { id: true, fullName: true, role: true } },
          },
        },
      },
    });
    if (!task) return reply.status(404).send({ success: false, error: 'Görev bulunamadı' });

    const isManager = staffUser.role === 'admin' || staffUser.role === 'it_manager';
    const isAssignee = task.assignees.some(a => a.staff.id === staffUser.id);
    const isCreator = task.createdBy.id === staffUser.id;

    // Yönetici yetkisi artık şirket kapsamına bağlı: kapsam dışı bir lokasyonun
    // görevine yalnızca atanan/oluşturan olarak erişilebilir.
    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    const inScope = isManager && isCompanyInScope(scope, task.location?.company.id ?? null);

    if (!inScope && !isAssignee && !isCreator) {
      return reply.status(403).send({ success: false, error: 'Bu göreve erişim yetkiniz yok' });
    }

    reply.send({ success: true, data: task });
  });

  // Create task — admin/it_manager only
  app.post('/', { preValidation: [app.requireRole('admin', 'it_manager')], schema: { body: taskCreateSchema, tags: ['Tasks'], summary: 'Görev oluştur' } }, async (request, reply) => {
    const body = taskCreateSchema.parse(request.body);
    const staffUser = request.staffUser!;

    // Validate assignees exist and active
    const assignees = await app.prisma.staff.findMany({
      where: { id: { in: body.assigneeIds }, isActive: true },
      select: { id: true, email: true, fullName: true },
    });
    if (assignees.length !== body.assigneeIds.length) {
      return reply.status(400).send({ success: false, error: 'Bazı atanan personeller bulunamadı veya aktif değil' });
    }

    const location = await app.prisma.location.findFirst({
      where: { id: body.locationId, isActive: true },
      select: { id: true, companyId: true },
    });
    if (!location) {
      return reply.status(400).send({ success: false, error: 'Lokasyon bulunamadı veya aktif değil' });
    }

    // Lokasyonun şirketi kapsam içinde olmalı — yoksa yönetici başka şirketin
    // lokasyonuna görev açabilirdi.
    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    if (!isCompanyInScope(scope, location.companyId)) {
      return reply.status(403).send({
        success: false,
        error: 'Yalnızca yetkili olduğunuz şirketlerin lokasyonlarına görev açabilirsiniz',
      });
    }

    const task = await app.prisma.task.create({
      data: {
        title: body.title,
        description: body.description,
        priority: body.priority,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        createdById: staffUser.id,
        locationId: body.locationId,
        assignees: {
          create: body.assigneeIds.map(staffId => ({ staffId })),
        },
      },
      select: TASK_SELECT,
    });

    // Audit
    await createAuditLog({
      entityType: 'task',
      entityId: task.id,
      action: 'create',
      changes: { title: body.title, assigneeIds: body.assigneeIds, priority: body.priority },
      performedBy: staffUser.email,
      ipAddress: request.headers['x-real-ip'] as string,
    });

    // SSE
    // Task'ta companyId yok — şirket location üzerinden bulunur.
    broadcastToStaff('task_created', {
      taskId: task.id,
      title: task.title,
      assigneeIds: body.assigneeIds,
    }, task.location?.company.id ?? null);

    // Email assignees
    const taskUrl = `${config.CANONICAL_URL}/staff/tasks/${task.id}`;
    for (const a of assignees) {
      await queueEmail({
        to: a.email,
        templateSlug: 'task_assigned',
        variables: {
          staffName: a.fullName,
          taskTitle: task.title,
          taskDescription: body.description.substring(0, 500),
          priority: body.priority,
          dueDate: body.dueDate ? new Date(body.dueDate).toLocaleString('tr-TR') : '—',
          createdBy: staffUser.email,
          taskUrl,
        },
      });
    }

    reply.status(201).send({ success: true, data: task });
  });

  // Update task — admin/it_manager only (full edit). Assignees can only change status via separate endpoint.
  app.put('/:id', { preValidation: [app.requireRole('admin', 'it_manager')], schema: { params: idParamsSchema, body: taskUpdateSchema, tags: ['Tasks'], summary: 'Görevi güncelle' } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = taskUpdateSchema.parse(request.body);
    const staffUser = request.staffUser!;

    const existing = await app.prisma.task.findUnique({
      where: { id },
      select: { id: true, status: true, completedAt: true, location: { select: { companyId: true } }, createdBy: { select: { email: true } }, assignees: { select: { staffId: true, staff: { select: { email: true, fullName: true } } } } },
    });
    if (!existing) return reply.status(404).send({ success: false, error: 'Görev bulunamadı' });

    // MEVCUT görev kapsam içinde mi?
    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    if (!isCompanyInScope(scope, existing.location?.companyId ?? null)) {
      return reply.status(403).send({ success: false, error: 'Bu görev için yetkiniz yok' });
    }

    const updateData: any = {};
    if (body.title !== undefined) updateData.title = body.title;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.priority !== undefined) updateData.priority = body.priority;
    if (body.dueDate !== undefined) updateData.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    // Görev başka bir lokasyona taşınabilir; SSE yayını görevin GÜNCEL şirketine
    // gitmeli, eskisine değil.
    let effectiveCompanyId: string | null = existing.location?.companyId ?? null;

    if (body.locationId !== undefined) {
      if (body.locationId) {
        const loc = await app.prisma.location.findFirst({
          where: { id: body.locationId, isActive: true },
          select: { id: true, companyId: true },
        });
        if (!loc) {
          return reply.status(400).send({ success: false, error: 'Lokasyon bulunamadı veya aktif değil' });
        }
        // HEDEF lokasyonun şirketi de kapsam içinde olmalı — yoksa görev
        // yetkili olunmayan bir şirkete taşınabilirdi.
        if (!isCompanyInScope(scope, loc.companyId)) {
          return reply.status(403).send({
            success: false,
            error: 'Görevi yetkili olmadığınız bir şirkete taşıyamazsınız',
          });
        }
        effectiveCompanyId = loc.companyId;
      } else if (scope !== null) {
        // Lokasyonu null'lamak görevi kapsam dışına çıkarır — yalnızca admin.
        return reply.status(403).send({
          success: false,
          error: 'Görevin lokasyonunu kaldıramazsınız',
        });
      } else {
        // admin lokasyonu kaldırdı → görev artık şirkete bağlı değil.
        effectiveCompanyId = null;
      }
      updateData.locationId = body.locationId;
    }

    if (body.status !== undefined && body.status !== existing.status) {
      updateData.status = body.status;
      if (body.status === 'done' && !existing.completedAt) {
        updateData.completedAt = new Date();
      } else if (body.status !== 'done') {
        updateData.completedAt = null;
      }
    }

    let newAssigneeIds: string[] | null = null;
    if (body.assigneeIds) {
      const valid = await app.prisma.staff.count({
        where: { id: { in: body.assigneeIds }, isActive: true },
      });
      if (valid !== body.assigneeIds.length) {
        return reply.status(400).send({ success: false, error: 'Bazı atanan personeller bulunamadı' });
      }
      newAssigneeIds = body.assigneeIds;
    }

    const task = await app.prisma.$transaction(async (tx) => {
      const t = await tx.task.update({ where: { id }, data: updateData });
      if (newAssigneeIds) {
        await tx.taskAssignee.deleteMany({ where: { taskId: id } });
        await tx.taskAssignee.createMany({
          data: newAssigneeIds.map(staffId => ({ taskId: id, staffId })),
        });
      }
      return t;
    });

    await createAuditLog({
      entityType: 'task',
      entityId: id,
      action: 'update',
      changes: body,
      performedBy: staffUser.email,
      ipAddress: request.headers['x-real-ip'] as string,
    });

    broadcastToStaff('task_updated', { taskId: id, status: task.status }, effectiveCompanyId);

    // Notify creator if status → done
    if (body.status === 'done' && existing.status !== 'done' && existing.createdBy.email) {
      const taskUrl = `${config.CANONICAL_URL}/staff/tasks/${id}`;
      await queueEmail({
        to: existing.createdBy.email,
        templateSlug: 'task_completed',
        variables: {
          taskTitle: task.title,
          completedBy: staffUser.email,
          taskUrl,
        },
      });
    }

    reply.send({ success: true, data: task });
  });

  // Status update — assignees can change own task status
  app.patch('/:id/status', { preValidation: [app.authenticate], schema: { params: idParamsSchema, body: taskStatusSchema, tags: ['Tasks'], summary: 'Görev durumunu güncelle' } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = taskStatusSchema.parse(request.body);
    const staffUser = request.staffUser!;

    const task = await app.prisma.task.findUnique({
      where: { id },
      select: {
        id: true, status: true, title: true,
        location: { select: { companyId: true } },
        createdBy: { select: { email: true, id: true } },
        assignees: { select: { staffId: true } },
      },
    });
    if (!task) return reply.status(404).send({ success: false, error: 'Görev bulunamadı' });

    const isManager = staffUser.role === 'admin' || staffUser.role === 'it_manager';
    const isAssignee = task.assignees.some(a => a.staffId === staffUser.id);

    // Yönetici yetkisi şirket kapsamına bağlı; atanan kişi her hâlükârda kendi
    // görevinin durumunu değiştirebilir.
    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    const inScope = isManager && isCompanyInScope(scope, task.location?.companyId ?? null);

    if (!inScope && !isAssignee) {
      return reply.status(403).send({ success: false, error: 'Bu görevi güncelleme yetkiniz yok' });
    }

    const updated = await app.prisma.task.update({
      where: { id },
      data: {
        status: body.status,
        completedAt: body.status === 'done' ? new Date() : null,
      },
      select: TASK_SELECT,
    });

    await createAuditLog({
      entityType: 'task',
      entityId: id,
      action: 'status_change',
      changes: { from: task.status, to: body.status },
      performedBy: staffUser.email,
      ipAddress: request.headers['x-real-ip'] as string,
    });

    broadcastToStaff('task_status_changed', { taskId: id, status: body.status }, task.location?.companyId ?? null);

    if (body.status === 'done' && task.status !== 'done' && task.createdBy.email && task.createdBy.id !== staffUser.id) {
      const taskUrl = `${config.CANONICAL_URL}/staff/tasks/${id}`;
      await queueEmail({
        to: task.createdBy.email,
        templateSlug: 'task_completed',
        variables: {
          taskTitle: task.title,
          completedBy: staffUser.email,
          taskUrl,
        },
      });
    }

    reply.send({ success: true, data: updated });
  });

  // Delete task — admin/it_manager only
  app.delete('/:id', { preValidation: [app.requireRole('admin', 'it_manager')], schema: { params: idParamsSchema, tags: ['Tasks'], summary: 'Görevi sil' } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const staffUser = request.staffUser!;

    const exists = await app.prisma.task.findUnique({
      where: { id },
      select: { id: true, location: { select: { companyId: true } } },
    });
    if (!exists) return reply.status(404).send({ success: false, error: 'Görev bulunamadı' });

    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    if (!isCompanyInScope(scope, exists.location?.companyId ?? null)) {
      return reply.status(403).send({ success: false, error: 'Bu görev için yetkiniz yok' });
    }

    await app.prisma.task.delete({ where: { id } });

    await createAuditLog({
      entityType: 'task',
      entityId: id,
      action: 'delete',
      performedBy: staffUser.email,
      ipAddress: request.headers['x-real-ip'] as string,
    });

    broadcastToStaff('task_deleted', { taskId: id }, exists.location?.companyId ?? null);

    reply.send({ success: true });
  });

  // Add comment
  app.post('/:id/comments', { preValidation: [app.authenticate], schema: { params: idParamsSchema, body: commentSchema, tags: ['Tasks'], summary: 'Göreve yorum ekle' } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = commentSchema.parse(request.body);
    const staffUser = request.staffUser!;

    const task = await app.prisma.task.findUnique({
      where: { id },
      select: {
        id: true, createdById: true,
        location: { select: { companyId: true } },
        assignees: { select: { staffId: true } },
      },
    });
    if (!task) return reply.status(404).send({ success: false, error: 'Görev bulunamadı' });

    const isManager = staffUser.role === 'admin' || staffUser.role === 'it_manager';
    const isAssignee = task.assignees.some(a => a.staffId === staffUser.id);
    const isCreator = task.createdById === staffUser.id;

    const scope = await getStaffCompanyScope(app.prisma, staffUser.id, staffUser.role);
    const inScope = isManager && isCompanyInScope(scope, task.location?.companyId ?? null);

    if (!inScope && !isAssignee && !isCreator) {
      return reply.status(403).send({ success: false, error: 'Bu göreve yorum yapma yetkiniz yok' });
    }

    const comment = await app.prisma.taskComment.create({
      data: {
        taskId: id,
        content: body.content,
        createdById: staffUser.id,
      },
      select: {
        id: true,
        content: true,
        createdAt: true,
        createdBy: { select: { id: true, fullName: true, role: true } },
      },
    });

    broadcastToStaff('task_comment_added', { taskId: id, commentId: comment.id }, task.location?.companyId ?? null);

    reply.status(201).send({ success: true, data: comment });
  });
};
