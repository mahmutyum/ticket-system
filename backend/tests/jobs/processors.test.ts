import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { isFinalAttempt, processEmailJob, processSmsJob } from '../../src/jobs/processors.js';

describe('notification job processors', () => {
  it('email şablonunu bağlama göre render eder ve sent kaydı oluşturur', async () => {
    const create = vi.fn(async () => ({}));
    const prisma = {
      staff: { findUnique: async () => null },
      ticket: { findUnique: async () => ({ locale: 'tr' }) },
      emailTemplate: { findFirst: async () => ({ subject: 'Talep {{name}}\r\nBcc:x', bodyHtml: '<b>{{name}}</b>', bodyText: 'Merhaba {{name}}' }) },
      companySmtp: { findUnique: async () => null },
      notification: { create },
    } as unknown as PrismaClient;
    const sender = vi.fn(async () => undefined);

    await processEmailJob({ to: 'a@example.com', templateSlug: 'created', variables: { name: '<Ali>' }, ticketId: 't1' }, prisma, sender);

    expect(sender).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Talep <Ali> Bcc:x',
      html: '<b>&lt;Ali&gt;</b>',
      text: 'Merhaba <Ali>',
    }), null, null);
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'sent', ticketId: 't1' }) });
  });

  it('SMS gönderimi başarısızsa sent bildirimi yazmaz', async () => {
    const create = vi.fn();
    const prisma = {
      staff: { findUnique: async () => null },
      ticket: { findUnique: async () => null },
      smsTemplate: { findFirst: async () => ({ body: 'Kod {{code}}' }) },
      notification: { create },
    } as unknown as PrismaClient;
    const sender = vi.fn(async () => { throw new Error('gateway down'); });

    await expect(processSmsJob({ to: '555', templateSlug: 'code', variables: { code: '42' } }, prisma, sender)).rejects.toThrow('gateway down');
    expect(create).not.toHaveBeenCalled();
  });

  it('yalnızca son retry sonrasında kalıcı failed kaydı gerektiğini belirler', () => {
    expect(isFinalAttempt(1, 3)).toBe(false);
    expect(isFinalAttempt(2, 3)).toBe(false);
    expect(isFinalAttempt(3, 3)).toBe(true);
  });
});
