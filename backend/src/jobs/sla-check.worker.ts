import { Worker } from 'bullmq';
import { queueEmail } from './queue.js';
import { redisConnection } from './queue.js';
import { prisma } from '../db.js';

const slaCheckWorker = new Worker(
  'sla-check',
  async () => {
    const now = new Date();

    const responseViolations = await prisma.ticket.findMany({
      where: {
        slaResponseDue: { lt: now },
        slaResponseMet: null,
        firstRespondedAt: null,
        status: { notIn: ['resolved', 'closed'] },
      },
      include: {
        assignedTo: { select: { email: true, fullName: true } },
        company: { select: { name: true } },
      },
    });

    for (const ticket of responseViolations) {
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { slaResponseMet: false },
      });

      if (ticket.assignedTo?.email) {
        await queueEmail({
          to: ticket.assignedTo.email,
          templateSlug: 'sla_warning',
          variables: {
            ticketNumber: ticket.ticketNumber,
            subject: ticket.subject,
            companyName: ticket.company.name,
            slaType: 'Yanıt Süresi',
            staffName: ticket.assignedTo.fullName,
          },
          ticketId: ticket.id,
          companyId: ticket.companyId,
        });
      }

      await prisma.ticketHistory.create({
        data: {
          ticketId: ticket.id,
          action: 'sla_violated',
          field: 'sla_response',
          newValue: 'SLA yanıt süresi aşıldı',
        },
      });

      console.log(`[SLA Check] Response SLA violated: ${ticket.ticketNumber}`);
    }

    const resolveViolations = await prisma.ticket.findMany({
      where: {
        slaResolveDue: { lt: now },
        slaResolveMet: null,
        resolvedAt: null,
        status: { notIn: ['resolved', 'closed'] },
      },
      include: {
        assignedTo: { select: { email: true, fullName: true } },
        company: { select: { name: true } },
      },
    });

    for (const ticket of resolveViolations) {
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { slaResolveMet: false },
      });

      if (ticket.assignedTo?.email) {
        await queueEmail({
          to: ticket.assignedTo.email,
          templateSlug: 'sla_warning',
          variables: {
            ticketNumber: ticket.ticketNumber,
            subject: ticket.subject,
            companyName: ticket.company.name,
            slaType: 'Çözüm Süresi',
            staffName: ticket.assignedTo.fullName,
          },
          ticketId: ticket.id,
          companyId: ticket.companyId,
        });
      }

      await prisma.ticketHistory.create({
        data: {
          ticketId: ticket.id,
          action: 'sla_violated',
          field: 'sla_resolution',
          newValue: 'SLA çözüm süresi aşıldı',
        },
      });

      console.log(`[SLA Check] Resolution SLA violated: ${ticket.ticketNumber}`);
    }

    console.log(`[SLA Check] Checked: ${responseViolations.length} response, ${resolveViolations.length} resolution violations`);
  },
  { connection: redisConnection },
);

export default slaCheckWorker;
