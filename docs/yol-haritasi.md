# Yol Haritası

Projenin güncel olgunluğu ve planlanan işler. Durum: 2026-07-17.

## Olgunluk özeti

| Alan | Durum |
|---|---|
| Özellik kapsamı | 🟢 Ticket yaşam döngüsü, SLA, raporlar, görevler, kasa, MFA |
| Çok dillilik | 🟢 TR/EN (arayüz + API mesajları + e-posta/SMS şablonları) |
| Kurulum / deploy | 🟢 Docker Compose, Coolify ve Nginx belgeli |
| Migration | 🟢 Versiyonlu; gerçek PostgreSQL üzerinde doğrulanabilir |
| Backend testleri | 🟢 235 birim/route/worker testi |
| Frontend testleri | 🟢 26 birim testi + 6 Playwright smoke/axe senaryosu |
| Entegrasyon | 🟢 Gerçek PostgreSQL + Redis testi |
| API dokümantasyonu | 🟢 Kritik route'larda request/response sözleşmeleri (OpenAPI) |
| Kod kalitesi | 🟢 Backend + frontend lint temiz, tipli |

## Planlanan özellikler

### "Taleplerim" — talep sahibi için birleşik takip

Bugün bir talebe erişim, o talebe özel bağlantı (veya ticket numarası + e-posta) ile
sağlanıyor; birden fazla talep açan kullanıcının hepsini tek yerde görmesi için bir
akış yok.

**Plan:** Kullanıcı e-postasını girer; gelen kutusuna gönderilen **kısa ömürlü doğrulama
bağlantısıyla** o e-postaya ait tüm taleplerini tek listede görür ve takip eder. Parola
yok — e-posta sahipliği doğrulanır. Mevcut altyapıyı (kısa ömürlü token, Redis, BullMQ
e-posta kuyruğu, rate limit) kullanır; yeni tablo gerektirmez. Yeni çift dilli
bildirim şablonu (`my_tickets_link`) ve bir public sayfa (`MyTicketsPage`) eklenir.

### Operasyon

- Yedek almanın yanında geri yükleme tatbikatını da periyodik çalıştır.
- Retention işini izle (`db:retention:check`) ve onaylı bakım penceresinde uygula.
- İnternete açık kurulumlarda erişim kontrolü ve `ENABLE_API_DOCS=false` zorunlu kabul et.

## Ürün tercihleri (bilinçli)

- Public portalda kalıcı kullanıcı hesabı / parola yoktur; erişim bağlantı tabanlıdır.
- Ayrı bir component kütüphanesi kullanılmaz; arayüz Tailwind ile proje içinde tutulur.
- Yerinde destek randevuları personele atanmaz; paralel randevu çakışma sayılmaz.
- Personel parolası en az 12 karakterdir.

## Katkı standardı

Yeni route ve ekranlarda aynı tipli sözleşme, kapsam/RBAC ve regresyon testi standardını
koru. Güvenlik açığı bildirimi için [SECURITY.md](../SECURITY.md), katkı rehberi için
[CONTRIBUTING.md](../CONTRIBUTING.md).
