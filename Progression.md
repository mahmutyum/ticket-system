# IT Ticket System — İlerleme Takibi

## Faz 1: Temel Altyapı ✅
**Durum**: Tamamlandı

### Yapılanlar
- Docker Compose yapısı (production + dev)
- Nginx reverse proxy (IP whitelist, SSL, rate limiting)
- Backend iskelet: Fastify + TypeScript + Prisma
- Prisma schema: 17 tablo
- Auth modülü: Staff JWT login/refresh/logout + public email lookup
- CRUD modülleri: companies, locations, categories, custom-fields, staff
- Ticket modülü: create, list, detail, update, bulk, search
- Public ticket erişim: access token ile görüntüleme, yanıt, email ile listeleme
- Notes modülü: public + internal notlar
- Dashboard, Onsite support, Notification modülleri
- Seed data: 3 şirket, 6 lokasyon, 13 kategori, 6 özel alan, 3 personel, şablonlar
- Frontend: Public sayfalar + Staff paneli (Dashboard, TicketList, TicketDetail)

---

## Faz 2: Ticket Oluşturma Geliştirmeleri ✅
**Durum**: Tamamlandı

### Yapılanlar
- Email service (Nodemailer + SMTP, template rendering)
- SMS service (generic HTTP gateway adapter)
- BullMQ queue altyapısı (email, sms, sla-check queues)
- Email/SMS workers: template → render → send → notification kayıt
- SLA check worker: periyodik (5dk) SLA ihlali kontrolü + bildirim
- Dosya yükleme: MIME validation, sanitized filenames, storage service
- Ticket oluşturma/status değişikliği → email + SMS bildirimi
- Frontend: dosya yükleme UI + attachment listesi

---

## Faz 3: IT Paneli Geliştirmeleri ✅
**Durum**: Tamamlandı

### Yapılanlar
- SSE (Server-Sent Events) altyapısı: staff + public ticket canlı güncellemeler
- SSE service: addClient, broadcastToStaff, broadcastToTicket, keep-alive ping
- Events route: `/events/staff` (auth), `/events/ticket/:accessToken` (public)
- Ticket create/update/note → SSE broadcast entegrasyonu
- Not ekleme sonrası kullanıcıya email bildirimi (public notlar için)
- Hazır yanıt (canned response) picker: TicketDetailPage'de not formuna entegre
- Canned responses API endpoint
- Frontend useSSE hook (staff + ticket)
- Staff yönetim sayfası: CRUD, rol atama, aktif/pasif toggle
- Şirket & lokasyon yönetim sayfası: CRUD, lokasyon ekleme
- Yerinde destek takvim sayfası: haftalık grid, status yönetimi
- Raporlar sayfası: SLA uyum, durum/öncelik dağılımı, şirket bazlı, CSV export
- Sidebar'a tüm sayfalar eklendi: Talepler, Yerinde Destek, Şirketler, Personel, Raporlar

---

## Faz 4-5-6-7: Birleşik — Bildirim, Yerinde Destek, Dashboard & Raporlar ✅
**Durum**: Tamamlandı (Faz 3 içinde erken tamamlandı)

### Yapılanlar
- Email/SMS bildirim sistemi tam fonksiyonel (queue + worker + template + retry)
- Yerinde destek: randevu oluşturma, takvim görünümü, status yönetimi, bildirim
- Dashboard: özet kartlar, dağılım grafikleri, SLA raporu, son talepler
- Raporlar: SLA uyum oranları, CSV export, filtreli istatistikler
- Onsite support takvim sayfası (haftalık grid + status actions)

---

## Faz 8: Gelişmiş Özellikler ✅
**Durum**: Tamamlandı

### Yapılanlar
- Audit log middleware: `createAuditLog()` — staff CRUD'a entegre, entity/action/changes/IP kaydı
- TicketDetailPage'den yerinde destek randevusu oluşturma (inline form + API entegrasyonu)
- Onsite support oluşturma → kullanıcıya otomatik email bildirimi (şablon bazlı)
- TicketDetailPage sidebar: mevcut randevular listesi + yeni randevu oluşturma formu
- Kategoriden auto-assignment seed data'da mevcut, ticket create'te otomatik çalışıyor

---

## Faz 9: Güvenlik & Kalite İyileştirmeleri ✅
**Durum**: Tamamlandı

### Yapılanlar — Güvenlik
- SSE auth düzeltmesi: EventSource query param token-based auth (jwt.verify)
- Rate limiting: `@fastify/rate-limit` global (100/dk) + login (5/dk) + ticket create (10/dk)
- CORS development: `localhost:3000,4000` ile sınırlandı (artık `true` değil)
- Ticket status validation: `z.string()` → `z.enum(VALID_STATUSES)` strict enum

### Yapılanlar — Eksik Modüller
- Templates modülü tam CRUD: email templates, SMS templates, canned responses
- TemplatesPage (frontend): 3 tab'lı yönetim arayüzü (email/sms/hazır yanıt)
- Reports modülü tam API: `/reports/tickets`, `/reports/staff-performance`, `/reports/categories`, `/reports/export/csv`
- ReportsPage geliştirildi: personel performans tablosu, kategori dağılımı, backend CSV export

### Yapılanlar — Bug Fixes
- Notification retry: artık gerçekten queue'ya re-enqueue ediyor
- Notification module: Zod schema validation, pagination, ticketId filtresi, stats endpoint
- Onsite schedule change: kullanıcıya email bildirim gönderimi (güncelleme + iptal)
- Canned responses: TicketDetailPage'de `/templates/canned` endpoint kullanıyor
- SSE reconnect: exponential backoff (max 10 retry)

---

## Faz 10: Şirket Bazlı SMTP ✅
**Durum**: Tamamlandı

### Yapılanlar
- **Prisma**: `CompanySmtp` modeli — host, port, secure, user, pass, fromName, fromEmail, isActive
- **Email Service**: Şirket bazlı transporter cache (10dk TTL), `sendEmailForCompany()`, `invalidateCompanyTransporter()`, `testSmtpConnection()`
- **Queue**: `EmailJobData`'ya `companyId` eklendi
- **Email Worker**: `companyId` varsa → company_smtp tablosundan config çek → o SMTP ile gönder, yoksa → global fallback
- **Companies API**: `GET/PUT/DELETE /:id/smtp` CRUD + `POST /:id/smtp/test` bağlantı testi
- **Tüm queueEmail çağrıları güncellendi**: tickets create/update, notes, onsite-support → hepsi `companyId` geçiriyor
- **Frontend CompanyManagementPage**: Her şirket kartında SMTP butonu + yapılandırma modal (host, port, SSL, user, pass, from, test bağlantısı, kaldırma)
- **Admin all endpoint**: SMTP config bilgisini include ediyor (şifre hariç)

---

## Faz 11: Domain Kısıtlama + Eksik Düzeltmeleri ✅
**Durum**: Tamamlandı

### Yapılanlar
- **Domain kısıtlama**: Company'ye `allowedDomains` alanı eklendi. Email domain'i eşleşmeyen şirketler wizard'da gösterilmez. Backend'de de doğrulama var. İzinli domainler hata mesajında ifşa edilmez
- **Tek lokasyon auto-select**: Şirketin 1 lokasyonu varsa otomatik seçilir ve lokasyon adımı atlanır
- **Kullanıcı yanıt bildirimi**: Public reply sonrası atanan IT personeline email + tüm staff'a SSE broadcast. Seed'e `user_reply` email şablonu eklendi
- **Public dosya yükleme**: Ticket oluştururken çoklu dosya seçimi + ticket takip sayfasından tek dosya yükleme. `POST /public/ticket/:accessToken/attachments` endpoint'i
- **CompanyManagementPage**: Şirket formuna "İzinli Email Domainleri" alanı eklendi. Şirket kartında domain kısıtı badge'i

### Staff Yönetimi (mevcut — doğrulandı)
- `/staff/staff-management` sayfası: Ekleme, düzenleme, rol değiştirme (admin/it_manager/it_staff), aktif/pasif toggle, şifre sıfırlama
- Backend: `POST/PUT/DELETE /staff` endpoints with RBAC (admin only)

---

## Proje Durumu: TAMAMLANDI ✅

### Tüm Özellikler
- ✅ Dockerize yapı (nginx + backend + frontend + postgres + redis)
- ✅ IP whitelist / VPN erişim (nginx geo)
- ✅ **Şirket domain kısıtlaması** (sadece izinli domainler ticket açabilir)
- ✅ Şirket/Lokasyon seçimi (tek lokasyonda otomatik seçim + adım atlama)
- ✅ Şirket grubuna göre kategori ve özel alanlar
- ✅ AnyDesk, telefon vb. özel alan girişi
- ✅ Ticket durumu + atama + süreç yönetimi
- ✅ Şifresiz kullanıcı (email tabanlı) + email ile eşleştirme
- ✅ Sadece IT'nin göreceği dahili notlar
- ✅ IT personel yönetimi (ekleme, rol değişikliği, aktif/pasif)
- ✅ Raporlama, personel performansı, kategori analizi, CSV export
- ✅ Email + SMS bildirim (BullMQ queue + retry)
- ✅ Şirket bazlı SMTP (her şirket kendi email sunucusu, global fallback)
- ✅ Kullanıcı yanıtında IT'ye bildirim (email + SSE)
- ✅ Yerinde destek randevu sistemi + takvim + güncelleme bildirimi
- ✅ SLA takibi + otomatik ihlal bildirimi
- ✅ SSE ile canlı güncellemeler (token-based auth + exponential backoff)
- ✅ Dosya ekleri (staff + public, MIME validation)
- ✅ Hazır yanıtlar (CRUD yönetimi)
- ✅ Şablon yönetimi (email/SMS/canned)
- ✅ Audit log
- ✅ Rate limiting (global + endpoint-specific)
- ✅ Strict input validation (Zod enum statuses)

---

## Faz 12: Kalite + Coolify Deploy Yapısı ✅
**Durum**: Tamamlandı

### Yapılanlar — Kalite
- SSE entegrasyonu: DashboardPage, TicketListPage, TicketStatusPage artık SSE ile canlı güncelleniyor (polling kaldırıldı)
- React ErrorBoundary: Sayfa crash'lerinde kullanıcı dostu hata ekranı
- Audit log kapsamı genişletildi: company create/update, staff update/deactivate, SMTP config değişiklikleri
- Public email lookup rate limit: 10/5dk
- Auth refresh token: `as any` → Zod schema validation
- Duplicate canned-responses endpoint kaldırıldı (notes route'tan)

### Yapılanlar — Coolify / NPM Deploy
- Docker Compose yeniden yapılandırıldı: tüm portlar `.env`'den kontrol edilir (`BACKEND_PORT`, `FRONTEND_PORT`, `DB_PORT`, `REDIS_PORT`)
- Dahili nginx → `profiles: [proxy]` ile opsiyonel hale getirildi (NPM varsa gerek yok)
- Frontend container: kendi nginx'i ile API proxy + SSE support + SPA routing
- Backend: `@fastify/static` ile uploads serve, healthcheck endpoint
- Tüm servislerde healthcheck tanımı
- `.env.example` Coolify-uyumlu: port, domain, SMTP bölümleri ayrı
- CLAUDE.md'ye Coolify + NPM deploy rehberi eklendi
