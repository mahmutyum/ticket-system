import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

/** Varlıklar — gerçek PostgreSQL: CSV içe aktarma (ekle/güncelle/hata), ticket bağlantısı. */

let app: FastifyInstance;
let prisma: PrismaClient;
let auth: { authorization: string };
let companyId: string;
let otherCompanyId: string;
const prefix = `IT${Date.now().toString(36).toUpperCase()}`;

beforeAll(async () => {
  const module = await import('../../src/app.js');
  app = await module.buildApp();
  await app.ready();
  prisma = (await import('../../src/db.js')).prisma;
  const token = (await app.inject({ method: 'POST', url: '/auth/staff/login', payload: { email: 'admin@company.com', password: 'admin123' } })).json().data.accessToken;
  auth = { authorization: `Bearer ${token}` };
  const companies = await prisma.company.findMany({ where: { isActive: true }, include: { locations: true }, take: 2, orderBy: { createdAt: 'asc' } });
  companyId = companies[0].id;
  otherCompanyId = companies[1].id;
});

afterAll(async () => {
  await prisma.asset.deleteMany({ where: { tag: { startsWith: prefix } } });
  await app.close();
});

describe('varlıklar — gerçek veritabanı', () => {
  it('CSV içe aktarma ekler, ikinci turda günceller, hatalı satırları raporlar', async () => {
    const location = await prisma.location.findFirstOrThrow({ where: { companyId } });
    const csv = `tag;name;type;serial;location;assigned_to\n${prefix}-1;Dell Latitude;Laptop;SN1;${location.name};ayse@example.com\n${prefix}-2;HP LaserJet;Yazıcı;;;\n;Eksik etiket;Laptop;;;\n${prefix}-3;X;Laptop;;Olmayan Lokasyon;`;
    const first = await app.inject({ method: 'POST', url: '/assets/import', headers: auth, payload: { companyId, csv } });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().data).toMatchObject({ created: 2, updated: 0 });
    expect(first.json().data.errors.map((e: { line: number }) => e.line)).toEqual([4, 5]);

    const again = await app.inject({ method: 'POST', url: '/assets/import', headers: auth, payload: { companyId, csv: `tag,name,type\n${prefix}-2,HP LaserJet Pro,Yazıcı` } });
    expect(again.json().data).toMatchObject({ created: 0, updated: 1 });

    const asset = await prisma.asset.findUniqueOrThrow({ where: { companyId_tag: { companyId, tag: `${prefix}-1` } } });
    expect(asset).toMatchObject({ locationId: location.id, assignedToEmail: 'ayse@example.com', serialNumber: 'SN1' });
  });

  it('ticket yalnızca kendi şirketinin varlığına bağlanır; varlık geçmişinde görünür', async () => {
    const category = await prisma.category.findFirstOrThrow({ where: { companyId, isActive: true }, include: { company: { include: { locations: true } } } });
    const domain = ((category.company!.allowedDomains as string[])[0]) ?? 'example.com';
    const created = await app.inject({
      method: 'POST', url: '/tickets',
      payload: { companyId, locationId: category.company!.locations[0].id, categoryId: category.id, email: `asset-${Date.now()}@${domain}`, fullName: 'Varlık Test', phone: '05551112233', subject: 'Laptop açılmıyor', description: 'Güç tuşuna basınca tepki yok' },
    });
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { accessToken: created.json().data.accessToken } });
    const own = await prisma.asset.findUniqueOrThrow({ where: { companyId_tag: { companyId, tag: `${prefix}-1` } } });
    const foreign = await prisma.asset.create({ data: { companyId: otherCompanyId, tag: `${prefix}-X`, name: 'Başka', assetType: 'Laptop' } });

    expect((await app.inject({ method: 'PUT', url: `/tickets/${ticket.id}/asset`, headers: auth, payload: { assetId: foreign.id } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: `/tickets/${ticket.id}/asset`, headers: auth, payload: { assetId: own.id } })).statusCode).toBe(200);

    const detail = await app.inject({ method: 'GET', url: `/assets/${own.id}`, headers: auth });
    expect(detail.json().data.tickets).toEqual([expect.objectContaining({ id: ticket.id })]);
    const ticketDetail = await app.inject({ method: 'GET', url: `/tickets/${ticket.id}`, headers: auth });
    expect(ticketDetail.json().data.asset).toMatchObject({ tag: `${prefix}-1` });
  });
});
