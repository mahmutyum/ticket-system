import { PrismaClient } from '@prisma/client';

export async function generateTicketNumber(prisma: PrismaClient): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `TKT-${year}-`;

  const lastTicket = await prisma.ticket.findFirst({
    where: { ticketNumber: { startsWith: prefix } },
    orderBy: { ticketNumber: 'desc' },
    select: { ticketNumber: true },
  });

  let nextNum = 1;
  if (lastTicket) {
    const lastNum = parseInt(lastTicket.ticketNumber.replace(prefix, ''), 10);
    nextNum = lastNum + 1;
  }

  return `${prefix}${String(nextNum).padStart(5, '0')}`;
}
