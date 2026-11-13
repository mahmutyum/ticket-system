import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { maybeSendSurvey } from '../../src/services/satisfaction.js';

type Row = Record<string, unknown>;

function prismaWith(ticket: Row | null, claimed = 1) {
  const updateMany = vi.fn(async () => ({ count: claimed }));
  const prisma = { ticket: { findUnique: vi.fn(async () => ticket), updateMany } } as unknown as PrismaClient;
  return { prisma, updateMany };
}

const base: Row = {
  id: 't1', ticketNumber: 'TKT-1', subject: 's', status: 'resolved', companyId: 'co', accessToken: 'tok',
  createdByEmail: 'u@acme.com', surveySentAt: null, satisfactionRating: null, mergedIntoId: null,
  createdBy: { fullName: 'U' }, company: { slaSettings: null },
};

describe('maybeSendSurvey', () => {
  it('çözülmüş talep için bir kez gönderir (koşullu işaretleme)', async () => {
    const { prisma, updateMany } = prismaWith(base);
    const queueEmail = vi.fn(async () => undefined);
    expect(await maybeSendSurvey(prisma, 't1', queueEmail)).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 't1', surveySentAt: null }, data: { surveySentAt: expect.any(Date) } });
    expect(queueEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'u@acme.com', templateSlug: 'ticket_survey' }));
  });

  // it.each nesne-case + $key interpolasyonu kullanır: printf (%o %s) biçimi
  // karışık şekilli case'lerde vitest'in tuple overload'ıyla çakışıp
  // typecheck:tests'i kırıyordu (bu hata main'de bir sürümdür vardı).
  it.each([
    { override: { status: 'in_progress' }, label: 'açık talep' },
    { override: { surveySentAt: new Date() }, label: 'zaten gönderilmiş' },
    { override: { satisfactionRating: 5 }, label: 'zaten puanlanmış' },
    { override: { mergedIntoId: 'x' }, label: 'birleştirilmiş' },
    { override: { company: { slaSettings: { satisfactionSurvey: false } } }, label: 'şirkette kapalı' },
  ])('$label → gönderilmez', async ({ override }) => {
    const { prisma } = prismaWith({ ...base, ...override });
    const queueEmail = vi.fn();
    expect(await maybeSendSurvey(prisma, 't1', queueEmail)).toBe(false);
    expect(queueEmail).not.toHaveBeenCalled();
  });

  it('yarışı kaybeden çağrı göndermez', async () => {
    const { prisma } = prismaWith(base, 0);
    const queueEmail = vi.fn();
    expect(await maybeSendSurvey(prisma, 't1', queueEmail)).toBe(false);
    expect(queueEmail).not.toHaveBeenCalled();
  });

  it('hata fırlatmaz', async () => {
    const prisma = { ticket: { findUnique: async () => { throw new Error('db'); } } } as unknown as PrismaClient;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(maybeSendSurvey(prisma, 't1', vi.fn())).resolves.toBe(false);
    spy.mockRestore();
  });
});
