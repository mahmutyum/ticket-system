import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import Redis from 'ioredis';
import { config } from '../config/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

const redisPluginFn: FastifyPluginAsync = async (app) => {
  // ioredis 6 RESP3'ü varsayılan yaptı — davranış değişikliğini sıfırlamak için
  // RESP2 sabitlenir (BullMQ + Lua eval akışları v5 davranışında kalır).
  const redis = new Redis(config.REDIS_URL, { protocol: 2 });

  redis.on('connect', () => {
    app.log.info('Redis connected');
  });

  redis.on('error', (err: Error) => {
    app.log.error({ err }, 'Redis error');
  });

  app.decorate('redis', redis);

  app.addHook('onClose', async () => {
    await redis.quit();
  });
};

export const redisPlugin = fp(redisPluginFn, {
  name: 'redis',
});
