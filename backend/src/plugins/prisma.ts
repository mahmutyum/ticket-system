import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';
import { prisma as sharedPrisma } from '../db.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

const prismaPluginFn: FastifyPluginAsync = async (app) => {
  await sharedPrisma.$connect();
  app.log.info('Database connected');

  app.decorate('prisma', sharedPrisma);

  app.addHook('onClose', async () => {
    await sharedPrisma.$disconnect();
  });
};

export const prismaPlugin = fp(prismaPluginFn, {
  name: 'prisma',
});
