import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { commonErrorResponses, successResponseSchema } from '../../utils/api-schema.js';
import { t } from '../../i18n/index.js';

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
const emailTemplateEntitySchema = z.object({
  id: z.string(),
  slug: z.string(),
  subject: z.string(),
  bodyHtml: z.string(),
  bodyText: z.string(),
  variables: z.unknown(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
const smsTemplateEntitySchema = z.object({
  id: z.string(),
  slug: z.string(),
  body: z.string(),
  variables: z.unknown(),
  createdAt: z.date(),
});
const cannedResponseEntitySchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  category: z.string().nullable(),
  sortOrder: z.number().int(),
  createdAt: z.date(),
});
const responseOf = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });

export const templateRoutes: FastifyPluginAsyncZod = async (app) => {
  // ==================== EMAIL TEMPLATES ====================

  app.get('/email', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: { tags: ['Templates'], summary: 'E-posta şablonlarını listele', response: { 200: responseOf(z.array(emailTemplateEntitySchema)), ...commonErrorResponses } },
  }, async (request, reply) => {
    const templates = await app.prisma.emailTemplate.findMany({
      orderBy: { slug: 'asc' },
    });
    reply.send({ success: true, data: templates });
  });

  app.get('/email/:id', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: { params: idParamsSchema, tags: ['Templates'], summary: 'E-posta şablonunu getir', response: { 200: responseOf(emailTemplateEntitySchema), ...commonErrorResponses } },
  }, async (request, reply) => {
    const { id } = request.params;
    const template = await app.prisma.emailTemplate.findUnique({ where: { id } });
    if (!template) {
      return reply.status(404).send({ success: false, error: t(request, 'templates.notFound') });
    }
    reply.send({ success: true, data: template });
  });

  app.post('/email', {
    preValidation: [app.requireRole('admin')],
    schema: { body: emailTemplateSchema, tags: ['Templates'], summary: 'E-posta şablonu oluştur', response: { 201: responseOf(emailTemplateEntitySchema), ...commonErrorResponses } },
  }, async (request, reply) => {
    const body = request.body;
    const template = await app.prisma.emailTemplate.create({
      data: { ...body, variables: body.variables },
    });
    reply.status(201).send({ success: true, data: template });
  });

  app.put('/email/:id', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: { params: idParamsSchema, body: emailTemplateUpdateSchema, tags: ['Templates'], summary: 'E-posta şablonunu güncelle', response: { 200: responseOf(emailTemplateEntitySchema), ...commonErrorResponses } },
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body;
    const template = await app.prisma.emailTemplate.update({
      where: { id },
      data: { ...body, variables: body.variables },
    });
    reply.send({ success: true, data: template });
  });

  app.delete('/email/:id', {
    preValidation: [app.requireRole('admin')],
    schema: { params: idParamsSchema, tags: ['Templates'], summary: 'E-posta şablonunu sil', response: { 200: successResponseSchema, ...commonErrorResponses } },
  }, async (request, reply) => {
    const { id } = request.params;
    await app.prisma.emailTemplate.delete({ where: { id } });
    reply.send({ success: true });
  });

  // ==================== SMS TEMPLATES ====================

  app.get('/sms', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: { tags: ['Templates'], summary: 'SMS şablonlarını listele', response: { 200: responseOf(z.array(smsTemplateEntitySchema)), ...commonErrorResponses } },
  }, async (request, reply) => {
    const templates = await app.prisma.smsTemplate.findMany({
      orderBy: { slug: 'asc' },
    });
    reply.send({ success: true, data: templates });
  });

  app.post('/sms', {
    preValidation: [app.requireRole('admin')],
    schema: { body: smsTemplateSchema, tags: ['Templates'], summary: 'SMS şablonu oluştur', response: { 201: responseOf(smsTemplateEntitySchema), ...commonErrorResponses } },
  }, async (request, reply) => {
    const body = request.body;
    const template = await app.prisma.smsTemplate.create({
      data: { ...body, variables: body.variables },
    });
    reply.status(201).send({ success: true, data: template });
  });

  app.put('/sms/:id', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: { params: idParamsSchema, body: smsTemplateUpdateSchema, tags: ['Templates'], summary: 'SMS şablonunu güncelle', response: { 200: responseOf(smsTemplateEntitySchema), ...commonErrorResponses } },
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body;
    const template = await app.prisma.smsTemplate.update({
      where: { id },
      data: { ...body, variables: body.variables },
    });
    reply.send({ success: true, data: template });
  });

  app.delete('/sms/:id', {
    preValidation: [app.requireRole('admin')],
    schema: { params: idParamsSchema, tags: ['Templates'], summary: 'SMS şablonunu sil', response: { 200: successResponseSchema, ...commonErrorResponses } },
  }, async (request, reply) => {
    const { id } = request.params;
    await app.prisma.smsTemplate.delete({ where: { id } });
    reply.send({ success: true });
  });

  // ==================== CANNED RESPONSES ====================

  app.get('/canned', {
    preValidation: [app.authenticate],
    schema: { tags: ['Templates'], summary: 'Hazır yanıtları listele', response: { 200: responseOf(z.array(cannedResponseEntitySchema)), ...commonErrorResponses } },
  }, async (request, reply) => {
    const responses = await app.prisma.cannedResponse.findMany({
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    });
    reply.send({ success: true, data: responses });
  });

  app.post('/canned', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: { body: cannedResponseSchema, tags: ['Templates'], summary: 'Hazır yanıt oluştur', response: { 201: responseOf(cannedResponseEntitySchema), ...commonErrorResponses } },
  }, async (request, reply) => {
    const body = request.body;
    const response = await app.prisma.cannedResponse.create({ data: body });
    reply.status(201).send({ success: true, data: response });
  });

  app.put('/canned/:id', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: { params: idParamsSchema, body: cannedResponseUpdateSchema, tags: ['Templates'], summary: 'Hazır yanıtı güncelle', response: { 200: responseOf(cannedResponseEntitySchema), ...commonErrorResponses } },
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body;
    const response = await app.prisma.cannedResponse.update({ where: { id }, data: body });
    reply.send({ success: true, data: response });
  });

  app.delete('/canned/:id', {
    preValidation: [app.requireRole('admin', 'it_manager')],
    schema: { params: idParamsSchema, tags: ['Templates'], summary: 'Hazır yanıtı sil', response: { 200: successResponseSchema, ...commonErrorResponses } },
  }, async (request, reply) => {
    const { id } = request.params;
    await app.prisma.cannedResponse.delete({ where: { id } });
    reply.send({ success: true });
  });
};
