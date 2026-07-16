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
const idParamsSchema = z.object({ id: z.string().min(1).max(128) });
const emailTemplateUpdateSchema = emailTemplateSchema.partial();
const smsTemplateUpdateSchema = smsTemplateSchema.partial();
const cannedResponseUpdateSchema = cannedResponseSchema.partial();

export const templateRoutes: FastifyPluginAsync = async (app) => {
  // ==================== EMAIL TEMPLATES ====================

  app.get('/email', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: { tags: ['Templates'], summary: 'E-posta şablonlarını listele' },
  }, async (request, reply) => {
    const templates = await app.prisma.emailTemplate.findMany({
      orderBy: { slug: 'asc' },
    });
    reply.send({ success: true, data: templates });
  });

  app.get('/email/:id', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: { params: idParamsSchema, tags: ['Templates'], summary: 'E-posta şablonunu getir' },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const template = await app.prisma.emailTemplate.findUnique({ where: { id } });
    if (!template) {
      return reply.status(404).send({ success: false, error: 'Şablon bulunamadı' });
    }
    reply.send({ success: true, data: template });
  });

  app.post('/email', {
    preValidation: [app.requireRole('admin')],
    schema: { body: emailTemplateSchema, tags: ['Templates'], summary: 'E-posta şablonu oluştur' },
  }, async (request, reply) => {
    const body = emailTemplateSchema.parse(request.body);
    const template = await app.prisma.emailTemplate.create({
      data: { ...body, variables: body.variables },
    });
    reply.status(201).send({ success: true, data: template });
  });

  app.put('/email/:id', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: { params: idParamsSchema, body: emailTemplateUpdateSchema, tags: ['Templates'], summary: 'E-posta şablonunu güncelle' },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = emailTemplateUpdateSchema.parse(request.body);
    const template = await app.prisma.emailTemplate.update({
      where: { id },
      data: { ...body, variables: body.variables },
    });
    reply.send({ success: true, data: template });
  });

  app.delete('/email/:id', {
    preValidation: [app.requireRole('admin')],
    schema: { params: idParamsSchema, tags: ['Templates'], summary: 'E-posta şablonunu sil' },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await app.prisma.emailTemplate.delete({ where: { id } });
    reply.send({ success: true });
  });

  // ==================== SMS TEMPLATES ====================

  app.get('/sms', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: { tags: ['Templates'], summary: 'SMS şablonlarını listele' },
  }, async (request, reply) => {
    const templates = await app.prisma.smsTemplate.findMany({
      orderBy: { slug: 'asc' },
    });
    reply.send({ success: true, data: templates });
  });

  app.post('/sms', {
    preValidation: [app.requireRole('admin')],
    schema: { body: smsTemplateSchema, tags: ['Templates'], summary: 'SMS şablonu oluştur' },
  }, async (request, reply) => {
    const body = smsTemplateSchema.parse(request.body);
    const template = await app.prisma.smsTemplate.create({
      data: { ...body, variables: body.variables },
    });
    reply.status(201).send({ success: true, data: template });
  });

  app.put('/sms/:id', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: { params: idParamsSchema, body: smsTemplateUpdateSchema, tags: ['Templates'], summary: 'SMS şablonunu güncelle' },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = smsTemplateUpdateSchema.parse(request.body);
    const template = await app.prisma.smsTemplate.update({
      where: { id },
      data: { ...body, variables: body.variables },
    });
    reply.send({ success: true, data: template });
  });

  app.delete('/sms/:id', {
    preValidation: [app.requireRole('admin')],
    schema: { params: idParamsSchema, tags: ['Templates'], summary: 'SMS şablonunu sil' },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await app.prisma.smsTemplate.delete({ where: { id } });
    reply.send({ success: true });
  });

  // ==================== CANNED RESPONSES ====================

  app.get('/canned', {
    preValidation: [app.authenticate],
    schema: { tags: ['Templates'], summary: 'Hazır yanıtları listele' },
  }, async (request, reply) => {
    const responses = await app.prisma.cannedResponse.findMany({
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    });
    reply.send({ success: true, data: responses });
  });

  app.post('/canned', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: { body: cannedResponseSchema, tags: ['Templates'], summary: 'Hazır yanıt oluştur' },
  }, async (request, reply) => {
    const body = cannedResponseSchema.parse(request.body);
    const response = await app.prisma.cannedResponse.create({ data: body });
    reply.status(201).send({ success: true, data: response });
  });

  app.put('/canned/:id', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: { params: idParamsSchema, body: cannedResponseUpdateSchema, tags: ['Templates'], summary: 'Hazır yanıtı güncelle' },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = cannedResponseUpdateSchema.parse(request.body);
    const response = await app.prisma.cannedResponse.update({ where: { id }, data: body });
    reply.send({ success: true, data: response });
  });

  app.delete('/canned/:id', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: { params: idParamsSchema, tags: ['Templates'], summary: 'Hazır yanıtı sil' },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await app.prisma.cannedResponse.delete({ where: { id } });
    reply.send({ success: true });
  });
};
