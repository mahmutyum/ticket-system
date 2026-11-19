# Screenshots / Ekran Görüntüleri

Çift dil (TR/EN) arayüzün otomatik üretilmiş ekran görüntüleri. Playwright
(chromium) ile `frontend/scripts/screenshots.mjs` üzerinden, çalışan dev ortamına
karşı alınır:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
docker compose ... exec backend npx tsx prisma/seed.ts   # demo verisi
cd frontend && node scripts/screenshots.mjs
```

Dil, i18next'in `localStorage.lang` algılaması zorlanarak ayarlanır; her sayfa hem
Türkçe hem İngilizce yakalanır.

## Public Portal

| Page / Sayfa | 🇹🇷 Türkçe | 🇬🇧 English |
|---|---|---|
| Home / Ana sayfa | ![](public-home-tr.png) | ![](public-home-en.png) |
| Create ticket / Talep oluştur | ![](public-create-ticket-tr.png) | ![](public-create-ticket-en.png) |
| Track / Talep takip | ![](public-track-tr.png) | ![](public-track-en.png) |

## Admin Panel / Yönetim Paneli

| Page / Sayfa | 🇹🇷 Türkçe | 🇬🇧 English |
|---|---|---|
| Login / Giriş | ![](staff-login-tr.png) | ![](staff-login-en.png) |
| Dashboard / Panel | ![](staff-dashboard-tr.png) | ![](staff-dashboard-en.png) |
| Tickets / Talepler | ![](staff-tickets-tr.png) | ![](staff-tickets-en.png) |
| Tasks / Görevler | ![](staff-tasks-tr.png) | ![](staff-tasks-en.png) |
| On-site / Yerinde Destek | ![](staff-onsite-tr.png) | ![](staff-onsite-en.png) |
| Companies / Şirketler | ![](staff-companies-tr.png) | ![](staff-companies-en.png) |
| Personel / Staff | ![](staff-management-tr.png) | ![](staff-management-en.png) |
| Reports / Raporlar | ![](staff-reports-tr.png) | ![](staff-reports-en.png) |
| Templates / Şablonlar | ![](staff-templates-tr.png) | ![](staff-templates-en.png) |
| Passwords / Şifreler | ![](staff-passwords-tr.png) | ![](staff-passwords-en.png) |
| Account / Hesap & Güvenlik | ![](staff-account-tr.png) | ![](staff-account-en.png) |

> Not: Talep konuları, kategori ve şirket adları gibi **veritabanı içerikleri**
> çevrilmez (kullanıcının girdiği veridir); yalnızca arayüz metinleri iki dillidir.
