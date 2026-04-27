import { redisConnection } from '../jobs/queue.js';
import { prisma } from '../db.js';

const SEED_AND_INCR_LUA = `if redis.call('EXISTS', KEYS[1]) == 0 then redis.call('SET', KEYS[1], ARGV[1]) end; return redis.call('INCR', KEYS[1])`;

/**
 * Compute the seed value for a year's ticket counter by reading the max existing
 * ticketNumber matching `TKT-${year}-` from the DB. Returns 0 if no tickets exist
 * for that year (so the first INCR returns 1).
 */
async function computeSeedForYear(year: number): Promise<number> {
  const prefix = `TKT-${year}-`;
  const last = await prisma.ticket.findFirst({
    where: { ticketNumber: { startsWith: prefix } },
    orderBy: { ticketNumber: 'desc' },
    select: { ticketNumber: true },
  });
  if (!last) return 0;
  const suffix = last.ticketNumber.slice(prefix.length);
  const parsed = parseInt(suffix, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Generate the next ticket number, atomically seeding the Redis counter from
 * the DB on cold-start so a wiped Redis cannot collide with existing tickets.
 */
export async function generateTicketNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const key = `ticket-counter:${year}`;

  // Seed value computed regardless — Lua script only uses it if the key is missing
  const seed = await computeSeedForYear(year);

  const result = (await redisConnection.eval(SEED_AND_INCR_LUA, 1, key, seed.toString())) as number;

  return `TKT-${year}-${String(result).padStart(5, '0')}`;
}

/**
 * Warm the ticket counter for the current year at boot.
 * Seeds the Redis key from the DB max if missing — without incrementing.
 * Safe to call multiple times; failures are surfaced to the caller.
 */
export async function warmTicketCounter(): Promise<void> {
  const year = new Date().getFullYear();
  const key = `ticket-counter:${year}`;

  const exists = await redisConnection.exists(key);
  if (exists) return;

  const seed = await computeSeedForYear(year);
  // SET NX so we don't race with a concurrent generateTicketNumber()
  await redisConnection.set(key, seed.toString(), 'NX');
}
