# Mimari

Teknik genel bakış. Kurulum için [kurulum.md](kurulum.md), kullanım için
[kullanim.md](kullanim.md).

---

## Genel yapı

```
İnternet/VPN → NPM (SSL + FQDN) → frontend:1111 ─┬─ /          → SPA (nginx)
                                                  ├─ /api/*     → backend:4000
                                                  └─ /uploads/* → backend:4000
                                                        │
                                          ┌─────────────┴─────────────┐
                                          │                           │
                                    postgres:5432               redis:6379
                                    (Prisma)                    (cache, kuyruk,
                                                                 refresh token)
```

Host'a yalnızca `frontend` açılır. `backend`, `postgres` ve `redis` dahili `app-network`
üzerinde kalır.

**API prefix:** Frontend `/api/*` çağırır → nginx prefix'i **soyar** → backend ham yolu
görür (`/auth/staff/login`). `/docs` içindeki yollar backend'in gördüğü ham yollardır.

---

## Depo yapısı

```
ticket-system/
├── docker-compose.yml          # Production
├── docker-compose.dev.yml      # Dev override (hot reload, NODE_ENV=development)
├── docker-compose.local.yml    # DB/Redis'i 127.0.0.1'e açar (yerel araçlar için)
├── nginx/                      # Opsiyonel dahili proxy (--profile proxy)
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma       # 24 model
│   │   ├── migrations/         # Versiyonlanmış migration'lar
│   │   └── seed.ts             # Demo veri
│   └── src/
│       ├── app.ts              # Fastify instance, plugin ve route registration
│       ├── server.ts           # Entry point, worker başlatma, SLA scheduler
│       ├── config/             # Zod env validation, sabitler
│       ├── plugins/            # prisma, redis, auth
│       ├── modules/<ad>/       # <ad>.routes.ts — her modül kendi dosyasında
│       ├── services/           # email, sms, sse, storage
│       ├── jobs/               # BullMQ queue + worker'lar
│       ├── middleware/         # audit log
│       └── utils/              # crypto, staff-scope, ticket-number, pagination, format
└── frontend/
    └── src/
        ├── api/client.ts       # Axios + JWT interceptor + auto-refresh
        ├── stores/auth.store.ts
        ├── hooks/useSSE.ts
        ├── components/
        └── pages/{public,staff}/
```

---

## Backend

**Stack:** Fastify 5, TypeScript (ESM), Prisma 6, Zod, BullMQ, nodemailer.

### Başlangıç sırası

`server.ts`:
1. `buildApp()` → Fastify instance (`app.ts`).
2. Ticket sayacını ısıtır (`utils/ticket-number.ts`).
3. Görev e-posta şablonlarını idempotent olarak seed'ler.
4. BullMQ scheduler: SLA kontrolü her 5 dakikada bir.
5. Worker'lar side-effect import ile başlar (`email.worker`, `sms.worker`, `sla-check.worker`).
6. `0.0.0.0:${PORT}` üzerinde dinler.

Container'da bundan önce `prisma migrate deploy` çalışır (bkz. `backend/Dockerfile` CMD).

### `app.ts` sırası

`trustProxy: true` → rate limit (global 100/dk) → CORS (`config.APP_ORIGINS`) → helmet
(CSP dahil) → cookie (`JWT_SECRET` ile imzalı) → multipart → prisma/redis/auth
plugin'leri → static `/uploads/` → **swagger `/docs`** → `/health` → modül route'ları →
global error handler (Türkçe; production'da 500 detaylarını gizler).

**CSP hakkında:** Backend'in CSP'si yalnızca kendi yanıtlarını etkiler. SPA'yı frontend
container'ındaki nginx servis ettiği için arayüzün asıl politikası `frontend/nginx.conf`
içindedir (`script-src 'self'`, unsafe-inline/eval yok — Vite build'i inline script
üretmez). Backend'de politika Swagger UI'ın çalışabileceği en sıkı hâldir; asıl kazanç
`/uploads`'a uygulanan `default-src 'none'; sandbox`'tır.

### Modüller

| Prefix | Sorumluluk |
|---|---|
| `/auth` | Staff JWT login/refresh/logout (login 5/dk), public e-posta lookup (10/5dk) |
| `/companies` | Şirket CRUD, branding (`/branding/by-host`), şirket SMTP, logo |
| `/locations` `/categories` `/custom-fields` | Şirkete bağlı tanımlar; kategoriler hiyerarşik + sıralanabilir |
| `/tickets` | CRUD, bulk, arama, ek dosya; `/notes` aynı prefix'te (public + internal) |
| `/public` | Token ile ticket görüntüleme, yanıt, ek dosya, tracking |
| `/staff` | Personel CRUD + şirket kapsamı atama |
| `/dashboard` | İstatistik, SLA, my-tickets |
| `/onsite-support` | Randevu CRUD + takvim |
| `/notifications` | Bildirim listesi, retry, stats |
| `/events` | SSE — staff, ticket, stats |
| `/templates` | E-posta / SMS şablonları, hazır yanıtlar |
| `/reports` | Ticket, personel performansı, kategori, SLA trendi, CSV export |
| `/tasks` | Görev CRUD + yorumlar |
| `/credentials` | Şifre kasası — `admin` + `it_manager` (şirket kapsamlı; global kayıtlar yalnızca admin) |

### API sözleşmesi

Tüm yanıtlar: `{ success: boolean, data?: T, error?: string }`

Input validation **handler içinde** Zod ile yapılır (`schema.parse(request.body)`), fastify'ın
`schema:` alanı kullanılmaz. Bunun bedeli: `/docs` request/response gövdelerini belgeleyemez.
Bkz. [yol-haritasi.md](yol-haritasi.md#51-api-şemaları-ve-dokümantasyon).

---

## Auth

**Staff — çift token:**

- **Access token:** 15 dk. `Authorization: Bearer` header'ı **veya** `access_token` cookie'si
  ile kabul edilir.
- **Refresh token:** 7 gün, httpOnly cookie. Ayrıca Redis'te `refresh:<staffId>` altında
  tutulur ve yenilemede **karşılaştırılır** — bu sayede çıkış sunucu tarafında gerçekten
  iptal eder.

Frontend access token'ı **bellekte** tutar (Zustand `partialize` yalnızca `user`'ı
kalıcılaştırır). Açılışta `initializeAuth()` refresh cookie'sinden oturumu geri kurar.
Axios interceptor 401'de bir kez otomatik yeniler (`_retry` guard), başarısızsa
`/staff/login`'e yönlendirir.

**Public — şifresiz:** Talep eden e-posta verir; ticket bir nanoid `accessToken` alır.
Link'i olan erişir.

**Decorator'lar** (`plugins/auth.ts`): `authenticate`, `authenticateOptional`,
`requireRole(...roles)`.

**Roller:** `admin`, `it_manager`, `it_staff`. Hiyerarşi yoktur — `requireRole` düz liste
kontrolü yapar, admin'e örtük geçiş hakkı tanımaz.

**Şirket kapsamı** (`utils/staff-scope.ts`) — çok şirketli izolasyonun tek dayanağı:

| Rol | `getStaffCompanyScope` döner |
|---|---|
| `admin` | `null` — kısıt yok |
| `it_manager`, `it_staff` | atandığı şirket id'leri (`StaffCompany` M:N) |
| atama yok | **boş dizi** — hiçbir şey görmez (fail-closed) |

Kapsam **JWT'de taşınmaz**, her istekte DB'den okunur — atama değişiklikleri anında etkili
olur, token yenilemeye gerek kalmaz.

Dört yardımcı vardır ve rol kontrolü bu dosyanın dışına **dağıtılmamalıdır**:

- `getStaffCompanyScope(prisma, staffId, role)` — kapsamı çözer.
- `companyWhereClause(scope)` — `where` fragment'i (`{}` veya `{ companyId: { in } }`).
- `isCompanyInScope(scope, companyId)` — tekil kontrol. **`companyId = null` ("global"
  kayıt) yalnızca admin'e açıktır** ve bu açıkça uygulanır; Postgres'in `IN` semantiğinin
  NULL'ları dışlamasına güvenilmez.
- `resolveCompanyFilter(scope, requested)` — istemciden gelen `companyId` filtresini
  kapsamla **kesiştirir**. Kapsam `where`'e yazılıp sonra parametreyle üzerine yazılırsa
  tek parametrelik yetki aşımı doğar (`?companyId=<başka-şirket>`); bu yüzden istemci
  filtresi daima buradan geçmelidir.

`Task`'ta `companyId` yoktur — kapsam `location → company` üzerinden iki adımda kurulur ve
`locationId` null olabilir; atanan/oluşturan erişimi ayrıca korunur ki kişi kendi
görevinden kilitlenmesin.

⚠️ **Şirket ataması (`PUT /staff/:id/companies`) yalnızca `admin`'dir.** Bu bir yetki
kararıdır: `it_manager`'a açılırsa kendine tüm şirketleri atayıp kapsamı anlamsız kılar.

---

## Veri modeli

24 model, 9 enum. Durum, öncelik, rol ve tip alanları **Prisma enum'udur** — geçerli küme
veritabanı seviyesinde zorlanır (önceden düz `String`'di ve yalnızca Zod koruyordu).

`config/constants.ts` bu enum'lardan **türetilir**; elle liste tutulmaz. Etiket sözlükleri
`Record<Enum, string>` tipindedir, yani şemaya değer ekleyip etiket yazmayı unutursan `tsc`
hata verir. Zod şemaları `z.nativeEnum(...)` ile bağlıdır.

İki alan bilinçli olarak `String`: `Company.groupType` (mevcut verilerde beklenmedik
değerler olabilir) ve `Notification.channel` (şablon slug'larıyla eşleşir, DB'den yönetilir).
Bkz. [yol-haritasi.md](yol-haritasi.md#52-enuma-çevrilmeyen-iki-alan).

**Çok şirketlilik:** `Company` → `Location`, `Category` (self-referencing hiyerarşi +
kategori bazlı SLA dakikaları + otomatik atama), `CustomField`, `CompanySmtp` (1:1),
`StaffCompany` (Staff ↔ Company M:N).

**Kişiler:** `User` (talep edenler, şifresiz) ve `Staff` (`passwordHash`, `role`) ayrı
modellerdir.

**Çekirdek:** `Ticket` — unique `ticketNumber`, unique `accessToken` (public erişim), SLA
alanları; `status`/`companyId`/`assignedToId`/`createdByEmail`/`createdAt` üzerinde index.
Bağlı: `TicketCustomValue`, `TicketNote` (`isInternal`), `TicketHistory`, `Attachment`,
`OnsiteSupport`, `Notification`.

**Şablonlar:** `TicketTemplate`, `CannedResponse`, `EmailTemplate`, `SmsTemplate`.

**Görevler:** `Task` → `TaskAssignee` (M:N), `TaskComment`.

**Diğer:** `AuditLog`, `CredentialEntry` (`passwordEnc`, `notesEnc`).

Migration'lar `prisma/migrations/` altında versiyonlanır; açılışta `migrate deploy` çalışır.
`db push` kullanılmaz.

---

## Kuyruk ve arka plan işleri

**BullMQ + Redis.** E-posta ve SMS gönderimi asenkron: **3 deneme, exponential backoff**.
Başarısız denemeler `Notification` tablosuna yazılır ve panelden retry edilebilir.

- `email.worker` — nodemailer. **Şirket bazlı SMTP:** şirketin `CompanySmtp` kaydı varsa
  onunla, yoksa global SMTP ile gönderir. Transporter'lar 10 dk cache'lenir.
- `sms.worker` — SMS gateway adapter'ı. Gateway tanımlı değilse devre dışı.
- `sla-check.worker` — her 5 dk; kategori bazlı yanıt/çözüm sürelerine göre SLA uyarısı üretir.

---

## Realtime — SSE

Tek yönlü Server-Sent Events. `hooks/useSSE.ts` exponential backoff ile yeniden bağlanır.

Kanallar: `/events/staff` (panel), `/events/ticket/:accessToken` (talep edenin durum sayfası),
`/events/stats`.

⚠️ Tarayıcının `EventSource` API'si özel header gönderemediği için staff kanalı JWT'yi
**query parametresinde** alır (`?token=`). Bu token'ı proxy log'larına düşürür — bkz.
[SECURITY.md](../SECURITY.md).

**NPM kullanıyorsan proxy host'ta Websockets Support açık olmalı**, yoksa SSE çalışmaz.

---

## Frontend

**Stack:** React 18, Vite 6, TypeScript, TailwindCSS 3, TanStack Query 5, Zustand 5, axios,
recharts, lucide-react, react-hot-toast. Component kütüphanesi **yok** — elle yazılmış Tailwind.

**Durum yönetimi:** Sunucu durumu TanStack Query (`staleTime: 30s`, `retry: 1`). İstemci
durumu yalnızca auth için Zustand.

**Build-time env yok:** SPA hiç `import.meta.env` kullanmaz. Yalnızca dev'de vite proxy'si
`VITE_API_PROXY_TARGET`'ı okur. Yani **tek bir frontend imajı her ortamda çalışır**.

**Branding:** `BrandingProvider` açılışta `/companies/branding/by-host` çağırır; host'a göre
şirketin logosunu ve tema rengini uygular. `ThemeProvider` karanlık modu yönetir.

---

## Öne çıkan mimari kararlar

| Karar | Gerekçe |
|---|---|
| Public portalda şifre yok, nanoid `accessToken` link'i | Talep edenin hesap açması/şifre hatırlaması istenmiyor. Sistem iç ağda. |
| Şifre kasasında hash değil **AES-256-GCM** | Şifrelerin tekrar **görüntülenmesi** gerekiyor; hash geri döndürülemez. Anahtar yalnızca env'de. |
| Kasada yalnızca `password`/`notes` şifreli | `title`/`category`/`url`/`username` düz kalır ki arama yapılabilsin. |
| Özel alanlar ayrı tabloda (JSON değil) | Raporlama ve validation kolaylığı. |
| Modül başına tek `routes.ts` | Küçük yüzey, dolaşması kolay. Controller/service katmanı yok. |
| Frontend build-time env'siz | Tek imaj, her ortam. Konfigürasyon tamamen runtime/backend tarafında. |
| `trustProxy: true` | NPM/Coolify arkasında gerçek client IP — rate-limit ve audit log doğru çalışsın. |
| Randevularda çakışma yok | Randevular personele atanmıyor; paralel randevu normal. |

---

## Kodlama kuralları

- Backend **ESM** (`"type": "module"`) — göreli import'larda **`.js` uzantısı zorunlu**
  (`./foo.js`, kaynak `.ts` olsa bile).
- Tüm input Zod ile doğrulanır.
- API yanıtı: `{ success, data?, error? }`.
- Türkçe hata mesajları ve UI label'ları.
- Durum/öncelik/rol sabitleri `config/constants.ts`'de.
- Admin/staff CRUD işlemlerinde `createAuditLog()` çağrılır.
- Frontend: dosya başına bir component, veri çekme TanStack Query ile.
