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
  const redis = new Redis(config.REDIS_URL);

  redis.on('connect', () => {
    app.log.info('Redis connected');
  });

  redis.on('error', (err) => {
    app.log.error('Redis error:', err);
  });

  app.decorate('redis', redis);

  app.addHook('onClose', async () => {
    await redis.quit();
  });
};

export const redisPlugin = fp(redisPluginFn, {
  name: 'redis',
});
