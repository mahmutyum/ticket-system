<div align="center">

# 🎫 IT Ticket System

**Şirket içi IT destek için, Docker ile kurulan çok şirketli ticket sistemi.**
Talep edenler için şifresiz public portal · IT ekibi için rollü yönetim paneli · **Türkçe / İngilizce çift dil.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Stack](https://img.shields.io/badge/stack-Fastify%20%2B%20React%20%2B%20Postgres-blue)
![i18n](https://img.shields.io/badge/i18n-TR%20%2F%20EN-green)
![Tests](https://img.shields.io/badge/tests-261%20passing-success)

[Özellikler](#-özellikler) · [Ekran görüntüleri](#-ekran-görüntüleri) · [Hızlı başlangıç](#-hızlı-başlangıç) · [Dokümantasyon](#-dokümantasyon) · [English](#english)

</div>

---

## ✨ Özellikler

**👤 Talep eden (public, giriş yok)**
- Ticket oluşturur — şirket / lokasyon / kategori seçer, şirkete özel dinamik alanları doldurur, dosya ekler.
- Aldığı **erişim linki** ile durumu canlı izler, yanıt yazar, ek gönderir.
- Ticket numarası + e-posta ile geçmiş talebini sorgular.

**🛠️ IT ekibi (yönetim paneli)**
- **Dashboard** — açık/kapalı istatistikleri, SLA durumu, üzerine atanmış işler.
- **Ticket yönetimi** — liste/filtre/arama, detay, durum & atama, iç not (talep edene görünmez) + public yanıt, toplu işlem.
- **Yerinde destek takvimi** — randevu oluşturma, süre seçimi, takvim görünümü.
- **Görevler** — ticket'tan bağımsız işler, çoklu atama, yorumlar.
- **Raporlar** — dağılım, personel performansı, kategori kırılımı, SLA trendi, CSV export.

**🔐 Yönetici (rol bazlı)**
- `admin` + `it_manager` — şirket / lokasyon / kategori / özel alan, şirket bazlı SMTP, e-posta & SMS şablonları, hazır yanıtlar.
- `admin` — personel yönetimi ve **şifre kasası** (AES-256-GCM, her görüntüleme audit'lenir).

**⚙️ Arka planda**
- E-posta / SMS bildirimleri BullMQ ile asenkron (3 deneme, exponential backoff).
- SLA kontrolü her 5 dakikada; kategori bazlı yanıt/çözüm süreleri.
- SSE ile panelde canlı güncelleme; domain'e göre şirket branding (logo + tema).
- **Çift dil**: arayüz tarayıcı diline göre açılır, düğmeyle anında geçilir; API mesajları `Accept-Language`'e, bildirimler alıcının diline göre.

---

## 📸 Ekran görüntüleri

Her ekran hem Türkçe hem İngilizce yakalanmıştır — **[tam galeri: docs/screenshots →](docs/screenshots/)** (14 sayfa × TR/EN).

| Public portal · TR | Yönetim paneli · EN |
|:---:|:---:|
| [<img src="docs/screenshots/public-home-tr.png" width="420">](docs/screenshots/public-home-tr.png) | [<img src="docs/screenshots/staff-dashboard-en.png" width="420">](docs/screenshots/staff-dashboard-en.png) |
| Talep oluşturma sihirbazı · TR | Talep listesi · EN |
| [<img src="docs/screenshots/public-create-ticket-tr.png" width="420">](docs/screenshots/public-create-ticket-tr.png) | [<img src="docs/screenshots/staff-tickets-en.png" width="420">](docs/screenshots/staff-tickets-en.png) |

---

## 🧰 Teknoloji

| Katman | Teknoloji |
|---|---|
| Backend | Node.js 22 · Fastify 5 · TypeScript (ESM) · Prisma 6 · Zod |
| Frontend | React 18 · Vite 6 · TailwindCSS 3 · TanStack Query 5 · Zustand 5 |
| Veritabanı | PostgreSQL 16 |
| Kuyruk / Cache | Redis 7 + BullMQ |
| Realtime | SSE (Server-Sent Events) |
| Çok dillilik | react-i18next · `Accept-Language` bazlı API mesajları |
| Deploy | Docker Compose (Coolify + Nginx Proxy Manager uyumlu) |

---

## 🚀 Hızlı başlangıç

> **Gereksinim:** Docker + Docker Compose. Başka bir şey kurmana gerek yok.

**1. Klonla ve `.env` hazırla**

```bash
git clone https://github.com/mahmutyum/ticket-system.git
cd ticket-system
cp .env.example .env
```

**2. Zorunlu secret'ları üret** (hiçbirinin varsayılanı yok — boşsa backend açılmaz):

```bash
openssl rand -base64 48   # → JWT_SECRET
openssl rand -base64 48   # → JWT_REFRESH_SECRET  (JWT_SECRET'tan farklı)
openssl rand -hex 32      # → CREDENTIALS_ENC_KEY (tam 64 hex)
```

Ayrıca `DB_PASSWORD` ve `REDIS_PASSWORD` belirle; ikisini `DATABASE_URL` / `REDIS_URL` içinde de **aynı** değerle güncelle.

**3. Başlat** (şema otomatik uygulanır):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

**4. Örnek veriyi yükle:**

```bash
docker compose exec backend npx tsx prisma/seed.ts   # temel veri
docker compose exec backend npm run db:seed:demo     # 36 talep, 24 görev, kasa vb. (opsiyonel)
```

Arayüz **http://localhost:1111** · API dokümanı **http://localhost:4000/docs**

### Örnek giriş (seed)

| Rol | E-posta | Şifre |
|---|---|---|
| admin | `admin@company.com` | `admin123` |
| it_manager | `manager@company.com` | `staff123` |
| it_staff | `it@company.com` | `staff123` |

> ⚠️ Sadece geliştirme içindir. **`seed.ts`'i asla production'a karşı çalıştırma** — production'da ilk admin'i elle oluştur.

---

## 🌐 Production

Detaylı anlatım: **[docs/kurulum.md](docs/kurulum.md)**. Kısaca, Coolify + Nginx Proxy Manager arkasında:

```
İnternet/VPN → NPM (SSL + FQDN) → frontend:1111 ─┬─ /              → SPA
                                                  ├─ /api/*         → backend:4000
                                                  ├─ /attachments/* → backend:4000  (yetki kontrollü)
                                                  └─ /branding/*    → backend:4000  (public logolar)
```

Sadece `frontend` host'a açılır (`FRONTEND_PORT`, varsayılan `1111`); backend, Postgres ve Redis yalnızca dahili Docker network'ünde kalır. Ekler ve logolar diskten değil **backend üzerinden** servis edilir (token ve şirket kapsamı kontrolleri orada).

> **Mevcut kurulumdan güncelliyorsan** proje `prisma db push` yerine versiyonlu migration'lara geçti; bir kereye mahsus baseline için [docs/kurulum.md](docs/kurulum.md#mevcut-veritabanını-baselineleme).

---

## 📚 Dokümantasyon

| Doküman | İçerik |
|---|---|
| [docs/kurulum.md](docs/kurulum.md) | Kurulum: geliştirme, production, Coolify/NPM, env, migration, sorun giderme |
| [docs/kullanim.md](docs/kullanim.md) | Kullanım: talep eden akışı, IT ekibi paneli, yönetici işlemleri |
| [docs/mimari.md](docs/mimari.md) | Mimari: modüller, veri modeli, auth, kuyruk, SSE |
| [docs/yol-haritasi.md](docs/yol-haritasi.md) | Olgunluk ve planlanan özellikler |
| [docs/operasyon.md](docs/operasyon.md) | Yedekleme, geri dönüş, retention, sağlık kontrolleri |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Katkı rehberi ve kodlama kuralları |
| [SECURITY.md](SECURITY.md) | Güvenlik açığı bildirimi |

---

## 🔒 Kurmadan önce

Bu sistem **iç ağ / VPN arkasında** çalışmak üzere tasarlandı. Public portal bilinçli olarak
kimlik doğrulaması yapmaz (erişim, tahmin edilemez bağlantı token'larına dayanır). İnternete
doğrudan açmadan önce kendi erişim kontrol katmanını (VPN, IP allowlist veya kimlik doğrulayan
reverse proxy) ekle. Ayrıntı: [SECURITY.md](SECURITY.md).

---

## 🤝 Katkı

Katkılar memnuniyetle karşılanır — [CONTRIBUTING.md](CONTRIBUTING.md) ile başla. Yeni route ve
ekranlarda tipli sözleşme, kapsam/RBAC ve regresyon testi standardını koru.

## 📄 Lisans

[MIT](LICENSE) © Mahmut YUM

---

<a name="english"></a>

## English

**IT Ticket System** — a dockerized, multi-tenant internal IT helpdesk with a **bilingual
Turkish/English UI** (auto-detected from the browser, switchable instantly). Requesters file
and track tickets through a passwordless public portal (unguessable access-token links); the
IT team works them through a role-based staff panel.

**Features:** ticket lifecycle with per-category SLA, dynamic per-company custom fields, file
attachments, internal vs. public notes, on-site support calendar, task management, reporting
with CSV export, an admin-only AES-256-GCM credential vault with audit logging, async email/SMS
via BullMQ, live updates over SSE, per-domain branding, and full TR/EN localization (UI, API
messages via `Accept-Language`, and notifications in the recipient's language).

**Stack:** Fastify 5 · Prisma 6 · PostgreSQL 16 · Redis 7 (backend) · React 18 · Vite 6 ·
TailwindCSS (frontend) · Docker Compose (deploy).

**Screenshots:** every screen in both TR & EN — see [docs/screenshots](docs/screenshots/).

**Quick start:**

```bash
git clone https://github.com/mahmutyum/ticket-system.git
cd ticket-system
cp .env.example .env
# Required, no defaults — generate each:
#   openssl rand -base64 48  → JWT_SECRET, JWT_REFRESH_SECRET
#   openssl rand -hex 32     → CREDENTIALS_ENC_KEY (exactly 64 hex)
# Also set DB_PASSWORD / REDIS_PASSWORD and mirror them into DATABASE_URL / REDIS_URL.
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
docker compose exec backend npx tsx prisma/seed.ts   # demo data — never in production
```

UI at http://localhost:1111 · API docs at http://localhost:4000/docs · demo login
`admin@company.com` / `admin123` (**development only**).

> **Designed to run behind a VPN / on an internal network.** The public portal is intentionally
> unauthenticated — do not expose it directly to the internet without your own access-control
> layer. See [SECURITY.md](SECURITY.md).

Docs are in Turkish: [installation](docs/kurulum.md) · [usage](docs/kullanim.md) ·
[architecture](docs/mimari.md) · [roadmap](docs/yol-haritasi.md) · [contributing](CONTRIBUTING.md)

**License:** [MIT](LICENSE) © Mahmut YUM
