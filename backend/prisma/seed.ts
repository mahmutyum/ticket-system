import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create admin staff
  const adminPassword = await bcrypt.hash('admin123', 12);
  const admin = await prisma.staff.upsert({
    where: { email: 'admin@company.com' },
    update: {},
    create: {
      email: 'admin@company.com',
      fullName: 'Sistem Yöneticisi',
      passwordHash: adminPassword,
      role: 'admin',
      department: 'IT',
    },
  });
  console.log('Admin created:', admin.email);

  // Create IT staff
  const staffPassword = await bcrypt.hash('staff123', 12);
  const itStaff = await prisma.staff.upsert({
    where: { email: 'it@company.com' },
    update: {},
    create: {
      email: 'it@company.com',
      fullName: 'IT Personeli',
      passwordHash: staffPassword,
      role: 'it_staff',
      department: 'IT',
    },
  });
  console.log('IT Staff created:', itStaff.email);

  const itManager = await prisma.staff.upsert({
    where: { email: 'manager@company.com' },
    update: {},
    create: {
      email: 'manager@company.com',
      fullName: 'IT Yöneticisi',
      passwordHash: staffPassword,
      role: 'it_manager',
      department: 'IT',
    },
  });
  console.log('IT Manager created:', itManager.email);

  // Create companies
  const company1 = await prisma.company.upsert({
    where: { name: 'ABC Çağrı Merkezi' },
    update: {},
    create: {
      name: 'ABC Çağrı Merkezi',
      groupType: 'call_center',
    },
  });

  const company2 = await prisma.company.upsert({
    where: { name: 'XYZ Kurumsal' },
    update: {},
    create: {
      name: 'XYZ Kurumsal',
      groupType: 'corporate',
    },
  });

  const company3 = await prisma.company.upsert({
    where: { name: 'DEF Lojistik' },
    update: {},
    create: {
      name: 'DEF Lojistik',
      groupType: 'warehouse',
    },
  });
  console.log('Companies created');

  // Create locations
  const locations = [
    { companyId: company1.id, name: 'İstanbul Merkez', address: 'İstanbul, Levent', floor: '3', itRoom: 'Oda 301' },
    { companyId: company1.id, name: 'Ankara Şube', address: 'Ankara, Çankaya', floor: '2', itRoom: 'Oda 205' },
    { companyId: company2.id, name: 'İstanbul Genel Müdürlük', address: 'İstanbul, Maslak', floor: '5', itRoom: 'IT Lab' },
    { companyId: company2.id, name: 'İzmir Bölge', address: 'İzmir, Konak', floor: '1' },
    { companyId: company3.id, name: 'Depo - Hadımköy', address: 'İstanbul, Hadımköy' },
    { companyId: company3.id, name: 'Depo - Gebze', address: 'Kocaeli, Gebze' },
  ];

  for (const loc of locations) {
    await prisma.location.upsert({
      where: { companyId_name: { companyId: loc.companyId, name: loc.name } },
      update: {},
      create: loc,
    });
  }
  console.log('Locations created');

  // Create categories - Call Center specific
  const catCallCenter = [
    { companyId: company1.id, name: 'Kulaklık / Headset Sorunu', sortOrder: 1, slaResponseMinutes: 15, slaResolutionMinutes: 60 },
    { companyId: company1.id, name: 'Yazılım / CRM Sorunu', sortOrder: 2, slaResponseMinutes: 10, slaResolutionMinutes: 30 },
    { companyId: company1.id, name: 'Telefon Hattı Sorunu', sortOrder: 3, slaResponseMinutes: 5, slaResolutionMinutes: 30 },
    { companyId: company1.id, name: 'Bilgisayar Donanım', sortOrder: 4, slaResponseMinutes: 30, slaResolutionMinutes: 120 },
  ];

  // Corporate categories
  const catCorporate = [
    { companyId: company2.id, name: 'Email / Outlook Sorunu', sortOrder: 1, slaResponseMinutes: 30, slaResolutionMinutes: 120 },
    { companyId: company2.id, name: 'VPN / Uzaktan Erişim', sortOrder: 2, slaResponseMinutes: 15, slaResolutionMinutes: 60 },
    { companyId: company2.id, name: 'Yazıcı / Tarayıcı', sortOrder: 3, slaResponseMinutes: 60, slaResolutionMinutes: 240 },
    { companyId: company2.id, name: 'Dosya Paylaşım / NAS', sortOrder: 4, slaResponseMinutes: 30, slaResolutionMinutes: 120 },
    { companyId: company2.id, name: 'Yeni Kullanıcı / Yetki Talebi', sortOrder: 5, slaResponseMinutes: 60, slaResolutionMinutes: 480 },
  ];

  // Global categories (for all companies)
  const catGlobal = [
    { companyId: null, name: 'İnternet / Ağ Bağlantısı', sortOrder: 10, slaResponseMinutes: 15, slaResolutionMinutes: 60 },
    { companyId: null, name: 'Bilgisayar Açılmıyor', sortOrder: 11, slaResponseMinutes: 15, slaResolutionMinutes: 120 },
    { companyId: null, name: 'Şifre Sıfırlama', sortOrder: 12, slaResponseMinutes: 10, slaResolutionMinutes: 15 },
    { companyId: null, name: 'Diğer', sortOrder: 99 },
  ];

  for (const cat of [...catCallCenter, ...catCorporate, ...catGlobal]) {
    await prisma.category.create({ data: cat });
  }
  console.log('Categories created');

  // Create custom fields
  const customFields = [
    // Call center specific
    { companyId: company1.id, fieldName: 'agent_id', fieldLabel: 'Agent ID / Dahili', fieldType: 'text', required: true, sortOrder: 1, placeholder: 'Örn: 1234' },
    { companyId: company1.id, fieldName: 'station_number', fieldLabel: 'İstasyon Numarası', fieldType: 'text', required: false, sortOrder: 2, placeholder: 'Örn: ST-45' },

    // Corporate specific
    { companyId: company2.id, fieldName: 'department_floor', fieldLabel: 'Departman / Kat', fieldType: 'text', required: false, sortOrder: 1 },

    // Global fields
    { companyId: null, fieldName: 'anydesk_id', fieldLabel: 'AnyDesk ID', fieldType: 'text', required: false, sortOrder: 10, placeholder: 'Örn: 123 456 789' },
    { companyId: null, fieldName: 'employee_phone', fieldLabel: 'İletişim Telefonu', fieldType: 'phone', required: false, sortOrder: 11, placeholder: '05XX XXX XX XX' },
    { companyId: null, fieldName: 'pc_name', fieldLabel: 'Bilgisayar Adı', fieldType: 'text', required: false, sortOrder: 12, placeholder: 'Örn: PC-ISTANBUL-045' },
  ];

  for (const field of customFields) {
    await prisma.customField.create({ data: field });
  }
  console.log('Custom fields created');

  // Create email templates
  const emailTemplates = [
    {
      slug: 'ticket_created',
      subject: 'Destek Talebiniz Oluşturuldu - {{ticketNumber}}',
      bodyHtml: `<h2>Destek Talebiniz Alındı</h2>
<p>Sayın {{userName}},</p>
<p>Destek talebiniz başarıyla oluşturuldu.</p>
<ul>
  <li><strong>Talep No:</strong> {{ticketNumber}}</li>
  <li><strong>Konu:</strong> {{subject}}</li>
  <li><strong>Öncelik:</strong> {{priority}}</li>
</ul>
<p>Talebinizi takip etmek için: <a href="{{trackingUrl}}">Buraya tıklayın</a></p>
<p>IT Destek Ekibi</p>`,
      bodyText: 'Destek Talebiniz Alındı\n\nTalep No: {{ticketNumber}}\nKonu: {{subject}}\nTakip: {{trackingUrl}}',
      variables: JSON.stringify(['ticketNumber', 'userName', 'subject', 'priority', 'trackingUrl']),
    },
    {
      slug: 'status_changed',
      subject: 'Talep Durumu Güncellendi - {{ticketNumber}}',
      bodyHtml: `<h2>Talep Durumu Güncellendi</h2>
<p>Sayın {{userName}},</p>
<p><strong>{{ticketNumber}}</strong> numaralı talebinizin durumu güncellendi.</p>
<ul>
  <li><strong>Önceki Durum:</strong> {{oldStatus}}</li>
  <li><strong>Yeni Durum:</strong> {{newStatus}}</li>
</ul>
<p>Detay: <a href="{{trackingUrl}}">Buraya tıklayın</a></p>`,
      bodyText: 'Talep durumu güncellendi.\nTalep No: {{ticketNumber}}\nYeni Durum: {{newStatus}}\nTakip: {{trackingUrl}}',
      variables: JSON.stringify(['ticketNumber', 'userName', 'oldStatus', 'newStatus', 'trackingUrl']),
    },
    {
      slug: 'onsite_scheduled',
      subject: 'Yerinde Destek Planlandı - {{ticketNumber}}',
      bodyHtml: `<h2>Yerinde Destek Planlandı</h2>
<p>Sayın {{userName}},</p>
<p><strong>{{ticketNumber}}</strong> numaralı talebiniz için yerinde destek planlanmıştır.</p>
<ul>
  <li><strong>Tarih/Saat:</strong> {{scheduledAt}}</li>
  <li><strong>Tür:</strong> {{supportType}}</li>
  <li><strong>Konum:</strong> {{locationInfo}}</li>
</ul>
<p>{{extraNote}}</p>`,
      bodyText: 'Yerinde destek planlandı.\nTalep: {{ticketNumber}}\nTarih: {{scheduledAt}}\nTür: {{supportType}}',
      variables: JSON.stringify(['ticketNumber', 'userName', 'scheduledAt', 'supportType', 'locationInfo', 'extraNote']),
    },
    {
      slug: 'sla_warning',
      subject: 'SLA İhlali - {{ticketNumber}}',
      bodyHtml: `<h2>SLA Süresi Aşıldı</h2>
<p>Sayın {{staffName}},</p>
<p><strong>{{ticketNumber}}</strong> numaralı talep için <strong>{{slaType}}</strong> süresi aşılmıştır.</p>
<ul>
  <li><strong>Şirket:</strong> {{companyName}}</li>
  <li><strong>Konu:</strong> {{subject}}</li>
</ul>
<p>Lütfen en kısa sürede ilgilenin.</p>`,
      bodyText: 'SLA İhlali: {{ticketNumber}} - {{slaType}} süresi aşıldı. Konu: {{subject}}',
      variables: JSON.stringify(['ticketNumber', 'staffName', 'slaType', 'companyName', 'subject']),
    },
    {
      slug: 'note_added',
      subject: 'Talebinize Yanıt Eklendi - {{ticketNumber}}',
      bodyHtml: `<h2>Talebinize Yanıt Eklendi</h2>
<p>Sayın {{userName}},</p>
<p><strong>{{ticketNumber}}</strong> numaralı talebinize IT ekibinden yanıt eklendi.</p>
<p>Detay: <a href="{{trackingUrl}}">Buraya tıklayın</a></p>`,
      bodyText: 'Talebinize yanıt eklendi. Talep: {{ticketNumber}}. Takip: {{trackingUrl}}',
      variables: JSON.stringify(['ticketNumber', 'userName', 'trackingUrl']),
    },
  ];

  for (const tmpl of emailTemplates) {
    await prisma.emailTemplate.upsert({
      where: { slug: tmpl.slug },
      update: {},
      create: tmpl,
    });
  }
  console.log('Email templates created');

  // Create SMS templates
  const smsTemplates = [
    {
      slug: 'ticket_created',
      body: 'IT Destek: {{ticketNumber}} numaralı talebiniz alındı. Takip: {{trackingUrl}}',
      variables: JSON.stringify(['ticketNumber', 'trackingUrl']),
    },
    {
      slug: 'onsite_scheduled',
      body: 'IT Destek: {{scheduledAt}} tarihinde yerinde destek planlandı. {{locationInfo}}',
      variables: JSON.stringify(['scheduledAt', 'locationInfo']),
    },
  ];

  for (const tmpl of smsTemplates) {
    await prisma.smsTemplate.upsert({
      where: { slug: tmpl.slug },
      update: {},
      create: tmpl,
    });
  }
  console.log('SMS templates created');

  // Create canned responses
  const cannedResponses = [
    { title: 'Bilgisayarı Yeniden Başlatın', content: 'Lütfen bilgisayarınızı yeniden başlatın ve sorunun devam edip etmediğini kontrol edin.', category: 'Genel', sortOrder: 1 },
    { title: 'AnyDesk Bağlantısı', content: 'Uzaktan bağlantı yapabilmemiz için lütfen AnyDesk uygulamasını açın ve ekranda görünen ID numarasını paylaşın.', category: 'Uzaktan Destek', sortOrder: 2 },
    { title: 'Şifre Sıfırlandı', content: 'Şifreniz sıfırlanmıştır. Yeni şifreniz: [GEÇİCİ ŞİFRE]. İlk girişte şifrenizi değiştirmeniz gerekmektedir.', category: 'Hesap', sortOrder: 3 },
    { title: 'IT Odasına Gelin', content: 'Sorununuzu yerinde incelememiz gerekmektedir. Lütfen cihazınızla birlikte IT odasına geliniz.', category: 'Yerinde Destek', sortOrder: 4 },
    { title: 'Sorun Çözüldü', content: 'Belirttiğiniz sorun tarafımızca çözülmüştür. Eğer sorun devam ediyorsa lütfen bu talep üzerinden bize bilgi veriniz.', category: 'Kapanış', sortOrder: 5 },
  ];

  for (const cr of cannedResponses) {
    await prisma.cannedResponse.create({ data: cr });
  }
  console.log('Canned responses created');

  console.log('\nSeed completed successfully!');
  console.log('Admin login: admin@company.com / admin123');
  console.log('Staff login: it@company.com / staff123');
  console.log('Manager login: manager@company.com / staff123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
