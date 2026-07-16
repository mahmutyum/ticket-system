# Ekran Görüntüleri / Screenshots

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

| Sayfa / Page | 🇹🇷 Türkçe | 🇬🇧 English |
|---|---|---|
| Ana sayfa / Home | ![](public-home-tr.png) | ![](public-home-en.png) |
| Talep oluştur / Create ticket | ![](public-create-ticket-tr.png) | ![](public-create-ticket-en.png) |
| Talep takip / Track | ![](public-track-tr.png) | ![](public-track-en.png) |

## Yönetim Paneli / Admin Panel

| Sayfa / Page | 🇹🇷 Türkçe | 🇬🇧 English |
|---|---|---|
| Giriş / Login | ![](staff-login-tr.png) | ![](staff-login-en.png) |
| Panel / Dashboard | ![](staff-dashboard-tr.png) | ![](staff-dashboard-en.png) |
| Talepler / Tickets | ![](staff-tickets-tr.png) | ![](staff-tickets-en.png) |
| Görevler / Tasks | ![](staff-tasks-tr.png) | ![](staff-tasks-en.png) |
| Yerinde Destek / Onsite | ![](staff-onsite-tr.png) | ![](staff-onsite-en.png) |
| Şirketler / Companies | ![](staff-companies-tr.png) | ![](staff-companies-en.png) |
| Personel / Staff | ![](staff-management-tr.png) | ![](staff-management-en.png) |
| Raporlar / Reports | ![](staff-reports-tr.png) | ![](staff-reports-en.png) |
| Şablonlar / Templates | ![](staff-templates-tr.png) | ![](staff-templates-en.png) |
| Şifreler / Passwords | ![](staff-passwords-tr.png) | ![](staff-passwords-en.png) |
| Hesap & Güvenlik / Account | ![](staff-account-tr.png) | ![](staff-account-en.png) |

> Not: Talep konuları, kategori ve şirket adları gibi **veritabanı içerikleri**
> çevrilmez (kullanıcının girdiği veridir); yalnızca arayüz metinleri iki dillidir.
