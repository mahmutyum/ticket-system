import { describe, expect, it, vi } from 'vitest';
import { StaffRole } from '@prisma/client';
import { authHeader, buildTestApp } from '../helpers/app.js';

vi.mock('../../src/db.js', () => ({
  prisma: { auditLog: { create: vi.fn() } },
}));

describe('şirket SMTP cevap sınırı', () => {
  it('veri katmanı yanlışlıkla döndürse bile SMTP parolasını yayınlamaz', async () => {
    const prisma = {
      companySmtp: {
        findUnique: vi.fn(async () => ({
          id: 'smtp-1',
          host: 'smtp.example.com',
          port: 587,
          secure: false,
          user: 'mailer',
          pass: 'encrypted-secret',
          fromName: 'Destek',
          fromEmail: 'support@example.com',
          isActive: true,
          updatedAt: new Date('2026-07-16T10:00:00Z'),
        })),
      },
    };
    const app = buildTestApp(prisma);
    const { companyRoutes } = await import('../../src/modules/companies/companies.routes.js');
    app.register(companyRoutes, { prefix: '/companies' });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/companies/company-1/smtp',
      headers: authHeader(StaffRole.admin),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).not.toHaveProperty('pass');
  });
});
