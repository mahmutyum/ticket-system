# IT Ticket System — İlerleme Takibi

> **Bu bir TARİHSEL kayıttır** — projenin hangi sırayla inşa edildiğini anlatır.
> Sistemin bugünkü hâli ve bilinen eksikler için buraya değil şuraya bak:
>
> - **[docs/yol-haritasi.md](docs/yol-haritasi.md)** — güncel durum ve açık maddeler
> - **[docs/mimari.md](docs/mimari.md)** — sistem nasıl çalışıyor
> - **[docs/kurulum.md](docs/kurulum.md)** — nasıl kurulur

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

## Faz 11 sonu itibarıyla özellik durumu

> Aşağıdaki liste **Faz 11'in bittiği andaki** kapsamı özetler. Sonrasında
> Faz 12-15 geldi (aşağıda). Projenin bugünkü durumu ve açık maddeler için
> [docs/yol-haritasi.md](docs/yol-haritasi.md).

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

---

## Faz 13: Görev Yönetimi + Şifre Kasası ✅
**Durum**: Tamamlandı (2026-06)

### Yapılanlar
- Görev yönetimi: `Task` / `TaskAssignee` / `TaskComment`, çoklu atama, yorumlar, görev e-posta şablonları
- Şifre kasası: `CredentialEntry`, AES-256-GCM şifreleme (`utils/crypto.ts`), admin korumalı REST modülü, her görüntülemede audit log
- Takvim: randevu süresi seçimi (`scheduledEnd`), gerçek süreyle orantılı çizim, paralel randevularda çakışma uyarısı kaldırıldı
- Tema ve şirket bazlı branding provider'ları

## Faz 14: Public Repo + Kılavuz ✅
**Durum**: Tamamlandı (2026-07)

### Yapılanlar
- Depo public yapıldı, MIT lisansı eklendi
- Dış kullanıcı kılavuzu: README (TR + EN özet), kurulum, kullanım, mimari, yol haritası, SECURITY, CONTRIBUTING
- **Kurulum engelleri giderildi**: `.env.example`'a eksik `CREDENTIALS_ENC_KEY` eklendi; `prisma/migrations/` hiç yoktu — baseline üretildi ve `db push --accept-data-loss` yerine versiyonlanmış migration'lara geçildi; `prisma` CLI prod imajında yoktu, dependencies'e taşındı; dev'de şema hiç uygulanmıyordu
- Swagger UI (`/docs`) bağlandı — paketler kuruluydu ama register edilmemişti

## Faz 15: Yetkilendirme Sertleştirmesi ✅
**Durum**: Tamamlandı (2026-07)

### Yapılanlar — Rol sistemi
- `it_manager` şirkete özel yönetici oldu: yalnızca `StaffCompany` ile atandığı şirketleri görür. `admin` sınırsız kalır.
- Kapsam **fail-closed**: atama yoksa hiçbir şey görünmez (eskiden atamasız personel her şeyi görüyordu)
- **Ayrıcalık yükseltmesi kapatıldı**: `PUT /staff/:id/companies` it_manager'a açıktı ve hedefin çağıran olup olmadığına bakmıyordu — yönetici kendine tüm şirketleri atayabiliyordu. Artık yalnızca admin.
- **Kapsam bypass'ı kapatıldı**: kapsam `where`'e yazılıp istemcinin `companyId` parametresiyle eziliyordu; artık `resolveCompanyFilter` ile kesiştiriliyor
- Kasa `it_manager`'a şirket kapsamlı açıldı; `companyId=null` global kayıtlar admin'e özel

### Yapılanlar — Güvenlik
- `CompanySmtp.pass` artık gerçekten şifreli (şemadaki "encrypted in production" yorumu yalandı). Eski kayıtlar için `npm run db:encrypt-smtp`
- CSP: SPA'yı frontend nginx servis ettiği için politika oraya yazıldı (`script-src 'self'`, unsafe-inline yok). `/uploads` → `default-src 'none'; sandbox`
- Seed production'a karşı kilitlendi (`--force` + güçlü şifre env'leri zorunlu)

### Yapılanlar — Veri modeli
- **Prisma enum'ları**: rol/durum/öncelik artık DB seviyesinde zorlanıyor (9 enum). Öncesinde düz `String`'di.
- Ticket `critical` vs görev `urgent` tutarsızlığı birleştirildi → `critical`
- `config/constants.ts` enum'lardan türetiliyor — elle liste tutulmuyor

### Yapılanlar — Test
- Kapsam ve crypto birim testleri + route seviyesinde auth/RBAC testleri
- Bulunan açıklar için mutasyon testi yapıldı (eski davranış geri konduğunda testler kırılıyor)
