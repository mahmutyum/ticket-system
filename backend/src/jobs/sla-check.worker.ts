import { Worker } from 'bullmq';
import { queueEmail, redisConnection } from './queue.js';
import { prisma } from '../db.js';
import { broadcastToStaff } from '../services/sse.service.js';
import { runSlaCheck } from './sla-check.js';

export const slaCheckWorker = new Worker(
  'sla-check',
  async () => {
    const result = await runSlaCheck(prisma, new Date(), { queueEmail, broadcast: broadcastToStaff });
    console.log(
      `[SLA Check] ${result.breaches} breaches, ${result.warnings} warnings, ${result.escalations} escalations`,
    );
  },
  { connection: redisConnection },
);

export default slaCheckWorker;
