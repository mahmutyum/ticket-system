import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

/** Bilgi bankası — gerçek PostgreSQL: yayın, şirket filtresi, çift dil, geri bildirim. */

let app: FastifyInstance;
let prisma: PrismaClient;
let auth: { authorization: string };
let companyId: string;
let otherCompanyId: string;
const ids: string[] = [];
const tag = `kb${Date.now()}`;

beforeAll(async () => {
  const module = await import('../../src/app.js');
  app = await module.buildApp();
  await app.ready();
  prisma = (await import('../../src/db.js')).prisma;
  const token = (await app.inject({ method: 'POST', url: '/auth/staff/login', payload: { email: 'admin@company.com', password: 'admin123' } })).json().data.accessToken;
  auth = { authorization: `Bearer ${token}` };
  const companies = await prisma.company.findMany({ where: { isActive: true }, take: 2, orderBy: { createdAt: 'asc' } });
  [companyId, otherCompanyId] = companies.map(c => c.id);
});

afterAll(async () => {
  await prisma.kbArticle.deleteMany({ where: { id: { in: ids } } });
  await app.close();
});

async function create(payload: Record<string, unknown>) {
  const res = await app.inject({ method: 'POST', url: '/kb', headers: auth, payload });
  expect(res.statusCode, res.body).toBe(200);
  ids.push(res.json().data.id);
  return res.json().data.id as string;
}

describe('bilgi bankası — gerçek veritabanı', () => {
  it('yalnızca yayındaki ve portal şirketine uygun makaleler görünür', async () => {
    const own = await create({ companyId, titleTr: `${tag} Yazıcı sürücüsü`, bodyTr: 'Sürücüyü **indirin**.', titleEn: `${tag} Printer driver`, bodyEn: 'Download the driver.', isPublished: true });
    await create({ companyId: otherCompanyId, titleTr: `${tag} Başka şirket`, bodyTr: 'Gizli', isPublished: true });
    await create({ companyId, titleTr: `${tag} Taslak`, bodyTr: 'Yayında değil', isPublished: false });

    const list = await app.inject({ method: 'GET', url: `/public/kb?companyId=${companyId}&q=${tag}` });
    const titles = list.json().data.map((a: { title: string }) => a.title);
    expect(titles).toEqual([`${tag} Yazıcı sürücüsü`]);

    const en = await app.inject({ method: 'GET', url: `/public/kb/${own}?companyId=${companyId}&locale=en` });
    expect(en.json().data).toMatchObject({ title: `${tag} Printer driver`, body: 'Download the driver.' });

    // Başka şirketin portalından şirkete özel makale okunamaz.
    const foreign = await app.inject({ method: 'GET', url: `/public/kb/${own}?companyId=${otherCompanyId}` });
    expect(foreign.statusCode).toBe(404);
  });

  it('geri bildirim ve talep açmadan çıkış sayılır', async () => {
    const id = ids[0];
    await app.inject({ method: 'POST', url: `/public/kb/${id}/feedback`, payload: { helpful: true, deflected: true } });
    await app.inject({ method: 'POST', url: `/public/kb/${id}/feedback`, payload: { helpful: false } });
    const article = await prisma.kbArticle.findUniqueOrThrow({ where: { id } });
    expect(article).toMatchObject({ helpfulYes: 1, helpfulNo: 1, deflections: 1 });
    expect(article.viewCount).toBeGreaterThanOrEqual(1);
  });
});
