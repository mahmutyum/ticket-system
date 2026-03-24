import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

const prismaPluginFn: FastifyPluginAsync = async (app) => {
  const prisma = new PrismaClient({
    log: app.log.level === 'debug'
      ? ['query', 'info', 'warn', 'error']
      : ['error'],
  });

  await prisma.$connect();
  app.log.info('Database connected');

  app.decorate('prisma', prisma);

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
};

export const prismaPlugin = fp(prismaPluginFn, {
  name: 'prisma',
});
