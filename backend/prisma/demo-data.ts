import { PrismaClient, Priority, TaskStatus, TicketStatus } from '@prisma/client';
import { encrypt } from '../src/utils/crypto.js';

const prisma = new PrismaClient();
const DAY = 24 * 60 * 60 * 1000;

const ticketSubjects = [
  'VPN bağlantısı sık sık kopuyor',
  'Outlook gelen kutusu eşitlenmiyor',
  'Çağrı kulaklığında ses kesiliyor',
  'Yazıcı kuyruğunda belgeler bekliyor',
  'CRM ekranı açılırken hata veriyor',
  'Toplantı odası ekranına görüntü gelmiyor',
  'Kablosuz ağ bağlantısı yavaş',
  'Yeni çalışan için erişim yetkileri',
  'Bilgisayar açılışta mavi ekran veriyor',
  'Ortak klasöre erişilemiyor',
];

const taskTitles = [
  'Toplantı odası cihaz envanterini kontrol et',
  'VPN istemcilerini güncelle',
  'Yedekleme raporunu incele',
  'Yeni personel bilgisayarını hazırla',
  'Yazıcı sarf malzemelerini say',
  'Kablosuz erişim noktalarını test et',
  'Dosya sunucusu yetkilerini gözden geçir',
  'Aylık güvenlik yamalarını uygula',
];

const credentialTitles = [
  'Demo DNS Yönetimi', 'Demo Santral Paneli', 'Demo Yazıcı Yönetimi',
  'Demo Test VPN', 'Demo Staging CRM', 'Demo Depo Wi-Fi',
  'Demo İzleme Paneli', 'Demo Yedekleme Konsolu', 'Demo NAS Yönetimi',
  'Demo Mobil Cihaz Yönetimi', 'Demo Lisans Portalı', 'Demo Kamera Test Sistemi',
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Demo veri scripti production ortamında çalıştırılamaz.');
  }

  const companies = await prisma.company.findMany({
    where: { isActive: true },
    include: { locations: true, categories: { where: { isActive: true } } },
    orderBy: { name: 'asc' },
  });
  const staff = await prisma.staff.findMany({ where: { isActive: true }, orderBy: { email: 'asc' } });
  const admin = staff.find((row) => row.role === 'admin');

  if (!companies.length || !admin || !staff.length) {
    throw new Error('Önce temel seed çalıştırılmalı: npm run db:seed');
  }

  const usableCompanies = companies.filter((company) => company.locations.length > 0);
  const globalCategories = await prisma.category.findMany({ where: { companyId: null, isActive: true } });
  if (!usableCompanies.length || !globalCategories.length) {
    throw new Error('Demo veri için en az bir lokasyon ve global kategori gerekli.');
  }

  const now = Date.now();
  const statuses = Object.values(TicketStatus);
  const priorities = Object.values(Priority);

  for (let index = 0; index < 36; index += 1) {
    const company = usableCompanies[index % usableCompanies.length];
    const location = company.locations[index % company.locations.length];
    const categories = company.categories.length ? company.categories : globalCategories;
    const category = categories[index % categories.length];
    const assigned = staff[index % staff.length];
    const status = statuses[index % statuses.length];
    const priority = priorities[index % priorities.length];
    const createdAt = new Date(now - index * 2 * DAY);
    const resolved = status === TicketStatus.resolved || status === TicketStatus.closed;
    const respondedAt = index % 5 === 0 ? null : new Date(createdAt.getTime() + (20 + index) * 60_000);
    const resolvedAt = resolved ? new Date(createdAt.getTime() + (4 + (index % 20)) * 3_600_000) : null;
    const ticketNumber = `DEMO-${String(index + 1).padStart(4, '0')}`;
    const email = `demo.kullanici${(index % 8) + 1}@example.test`;

    const user = await prisma.user.upsert({
      where: { email },
      update: { companyId: company.id, locationId: location.id },
      create: {
        email,
        fullName: `Demo Kullanıcı ${(index % 8) + 1}`,
        companyId: company.id,
        locationId: location.id,
        department: ['Finans', 'Operasyon', 'İnsan Kaynakları', 'Satış'][index % 4],
      },
    });

    const ticket = await prisma.ticket.upsert({
      where: { ticketNumber },
      update: {
        companyId: company.id, locationId: location.id, categoryId: category.id,
        createdByEmail: email, createdByUserId: user.id, assignedToId: assigned.id,
        subject: ticketSubjects[index % ticketSubjects.length],
        description: `Bu kayıt arayüz ve rapor ekranlarını değerlendirmek için üretilmiş sentetik demo talebidir. Senaryo sıra numarası: ${index + 1}.`,
        priority, status, createdAt, firstRespondedAt: respondedAt, resolvedAt,
        closedAt: status === TicketStatus.closed ? resolvedAt : null,
        slaResponseDue: new Date(createdAt.getTime() + 60 * 60_000),
        slaResolveDue: new Date(createdAt.getTime() + 8 * 3_600_000),
        slaResponseMet: respondedAt ? respondedAt.getTime() <= createdAt.getTime() + 60 * 60_000 : false,
        slaResolveMet: resolvedAt ? resolvedAt.getTime() <= createdAt.getTime() + 8 * 3_600_000 : null,
      },
      create: {
        ticketNumber, companyId: company.id, locationId: location.id, categoryId: category.id,
        createdByEmail: email, createdByUserId: user.id, assignedToId: assigned.id,
        subject: ticketSubjects[index % ticketSubjects.length],
        description: `Bu kayıt arayüz ve rapor ekranlarını değerlendirmek için üretilmiş sentetik demo talebidir. Senaryo sıra numarası: ${index + 1}.`,
        priority, status, accessToken: `demo-access-token-${String(index + 1).padStart(4, '0')}`,
        createdAt, firstRespondedAt: respondedAt, resolvedAt,
        closedAt: status === TicketStatus.closed ? resolvedAt : null,
        slaResponseDue: new Date(createdAt.getTime() + 60 * 60_000),
        slaResolveDue: new Date(createdAt.getTime() + 8 * 3_600_000),
        slaResponseMet: respondedAt ? respondedAt.getTime() <= createdAt.getTime() + 60 * 60_000 : false,
        slaResolveMet: resolvedAt ? resolvedAt.getTime() <= createdAt.getTime() + 8 * 3_600_000 : null,
      },
    });

    await prisma.ticketNote.deleteMany({ where: { ticketId: ticket.id } });
    await prisma.ticketHistory.deleteMany({ where: { ticketId: ticket.id } });
    await prisma.onsiteSupport.deleteMany({ where: { ticketId: ticket.id } });
    await prisma.ticketNote.createMany({ data: [
      { ticketId: ticket.id, createdById: assigned.id, isInternal: true, content: 'Demo iç not: İlk inceleme ve bağlantı kontrolleri tamamlandı.' },
      { ticketId: ticket.id, createdById: assigned.id, isInternal: false, content: 'Talebinizi aldık. Gerekli kontrolleri sürdürüyoruz.' },
    ] });
    await prisma.ticketHistory.createMany({ data: [
      { ticketId: ticket.id, action: 'created', createdByEmail: email, createdAt },
      { ticketId: ticket.id, action: 'assigned', field: 'assignedToId', newValue: assigned.id, createdById: admin.id, createdAt: new Date(createdAt.getTime() + 10 * 60_000) },
      ...(status !== TicketStatus.open ? [{ ticketId: ticket.id, action: 'status_changed', field: 'status', oldValue: TicketStatus.open, newValue: status, createdById: assigned.id }] : []),
    ] });

    if (index < 8) {
      await prisma.onsiteSupport.create({ data: {
        ticketId: ticket.id, locationId: location.id,
        type: index % 2 === 0 ? 'visit_employee' : 'meeting_room',
        status: index % 3 === 0 ? 'completed' : 'scheduled',
        scheduledAt: new Date(now + (index - 2) * DAY),
        scheduledEnd: new Date(now + (index - 2) * DAY + 60 * 60_000),
        roomInfo: index % 2 === 0 ? 'Kullanıcı masası' : `Toplantı Odası ${index + 1}`,
        notes: 'Sentetik demo yerinde destek kaydı.',
        completedAt: index % 3 === 0 ? new Date(now - DAY) : null,
      } });
    }
  }

  await prisma.task.deleteMany({ where: { title: { startsWith: '[DEMO]' } } });
  for (let index = 0; index < 24; index += 1) {
    const company = usableCompanies[index % usableCompanies.length];
    const creator = staff[index % staff.length];
    const status = Object.values(TaskStatus)[index % Object.values(TaskStatus).length];
    await prisma.task.create({ data: {
      title: `[DEMO] ${taskTitles[index % taskTitles.length]}`,
      description: `Planlama ve görev listesi görünümünü değerlendirmek için sentetik iş kaydı #${index + 1}.`,
      priority: priorities[index % priorities.length], status,
      dueDate: new Date(now + (index - 8) * DAY), createdById: creator.id,
      locationId: company.locations[index % company.locations.length].id,
      completedAt: status === TaskStatus.done ? new Date(now - index * 3_600_000) : null,
      assignees: { create: [{ staffId: staff[(index + 1) % staff.length].id }] },
      comments: { create: [{ createdById: creator.id, content: 'Demo görev notu: Kontrol listesi oluşturuldu.' }] },
    } });
  }

  await prisma.credentialEntry.deleteMany({ where: { title: { startsWith: 'Demo ' } } });
  for (let index = 0; index < 24; index += 1) {
    const company = index % 5 === 0 ? null : usableCompanies[index % usableCompanies.length];
    await prisma.credentialEntry.create({ data: {
      title: `${credentialTitles[index % credentialTitles.length]} ${Math.floor(index / credentialTitles.length) + 1}`,
      category: ['Altyapı', 'Uygulama', 'Ağ', 'Test Ortamı'][index % 4],
      url: `https://demo-${index + 1}.example.test`, username: `demo-user-${index + 1}`,
      passwordEnc: encrypt(`Demo-Only-${index + 1}!Safe`),
      notesEnc: encrypt('Yalnızca yerel arayüz testi için üretilmiş sentetik kayıttır.'),
      companyId: company?.id, createdById: admin.id,
    } });
  }

  console.log('Demo veri hazır: 36 talep, 24 görev, 8 yerinde destek ve 24 kasa kaydı.');
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
