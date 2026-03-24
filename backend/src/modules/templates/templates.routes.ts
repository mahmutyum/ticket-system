import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const emailTemplateSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z_]+$/),
  subject: z.string().min(1),
  bodyHtml: z.string().min(1),
  bodyText: z.string().min(1),
  variables: z.array(z.string()).default([]),
});

const smsTemplateSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z_]+$/),
  body: z.string().min(1),
  variables: z.array(z.string()).default([]),
});

const cannedResponseSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  category: z.string().optional(),
  sortOrder: z.number().int().default(0),
});

export const templateRoutes: FastifyPluginAsync = async (app) => {
  // ==================== EMAIL TEMPLATES ====================

  app.get('/email', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const templates = await app.prisma.emailTemplate.findMany({
      orderBy: { slug: 'asc' },
    });
    reply.send({ success: true, data: templates });
  });

  app.get('/email/:id', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const template = await app.prisma.emailTemplate.findUnique({ where: { id } });
    if (!template) {
      return reply.status(404).send({ success: false, error: 'Şablon bulunamadı' });
    }
    reply.send({ success: true, data: template });
  });

  app.post('/email', {
    preHandler: [app.requireRole('admin')],
  }, async (request, reply) => {
    const body = emailTemplateSchema.parse(request.body);
    const template = await app.prisma.emailTemplate.create({
      data: { ...body, variables: body.variables },
    });
    reply.status(201).send({ success: true, data: template });
  });

  app.put('/email/:id', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = emailTemplateSchema.partial().parse(request.body);
    const template = await app.prisma.emailTemplate.update({
      where: { id },
      data: { ...body, variables: body.variables },
    });
    reply.send({ success: true, data: template });
  });

  app.delete('/email/:id', {
    preHandler: [app.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await app.prisma.emailTemplate.delete({ where: { id } });
    reply.send({ success: true });
  });

  // ==================== SMS TEMPLATES ====================

  app.get('/sms', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const templates = await app.prisma.smsTemplate.findMany({
      orderBy: { slug: 'asc' },
    });
    reply.send({ success: true, data: templates });
  });

  app.post('/sms', {
    preHandler: [app.requireRole('admin')],
  }, async (request, reply) => {
    const body = smsTemplateSchema.parse(request.body);
    const template = await app.prisma.smsTemplate.create({
      data: { ...body, variables: body.variables },
    });
    reply.status(201).send({ success: true, data: template });
  });

  app.put('/sms/:id', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = smsTemplateSchema.partial().parse(request.body);
    const template = await app.prisma.smsTemplate.update({
      where: { id },
      data: { ...body, variables: body.variables },
    });
    reply.send({ success: true, data: template });
  });

  app.delete('/sms/:id', {
    preHandler: [app.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await app.prisma.smsTemplate.delete({ where: { id } });
    reply.send({ success: true });
  });

  // ==================== CANNED RESPONSES ====================

  app.get('/canned', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const responses = await app.prisma.cannedResponse.findMany({
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    });
    reply.send({ success: true, data: responses });
  });

  app.post('/canned', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const body = cannedResponseSchema.parse(request.body);
    const response = await app.prisma.cannedResponse.create({ data: body });
    reply.status(201).send({ success: true, data: response });
  });

  app.put('/canned/:id', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = cannedResponseSchema.partial().parse(request.body);
    const response = await app.prisma.cannedResponse.update({ where: { id }, data: body });
    reply.send({ success: true, data: response });
  });

  app.delete('/canned/:id', {
    preHandler: [app.requireRole('admin', 'it_manager')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await app.prisma.cannedResponse.delete({ where: { id } });
    reply.send({ success: true });
  });
};
