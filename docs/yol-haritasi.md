# Yol Haritası ve Bilinen Eksikler

Bu belge projenin güncel durumunu ve bilinçli olarak açık bırakılan sınırları
özetler. Tarihsel uygulama planı değildir.

Durum: 2026-07-16.

## Olgunluk özeti

| Alan | Durum |
|---|---|
| Özellik kapsamı | 🟢 Ticket yaşam döngüsü, SLA, raporlar, görevler, kasa, MFA |
| Kurulum / deploy | 🟢 Docker Compose, Coolify ve Nginx belgeli |
| Migration | 🟢 Versiyonlu; gerçek PostgreSQL üzerinde doğrulanabilir |
| Backend testleri | 🟢 230 birim/route/worker testi |
| Frontend testleri | 🟢 25 birim testi + 6 Playwright smoke/axe/güvenlik senaryosu |
| Entegrasyon | 🟢 Gerçek PostgreSQL + Redis testi mevcut |
| CI | 🟡 Güvenlik tercihiyle yalnızca GitHub Actions'tan elle çalıştırılıyor |
| API dokümantasyonu | 🟢 Kritik yönetim route'larında request, parametre ve response sözleşmeleri bağlı |
| Kod kalitesi | 🟢 Backend ve frontend lint temiz; gevşek `any` tipleri kaldırıldı |
| Public repo hijyeni | 🟢 Yerel kontrol script'i, geniş ignore politikası ve yayın rehberi |

## Sıradaki çalışmalar

### Operasyon

- Yedek alma kadar geri yükleme tatbikatını da periyodik çalıştır.
- `db:retention:check` sonucunu izle; onaylı bakım penceresinde
  `db:retention:apply` çalıştır.
- Public internete açık kurulumlarda `ENABLE_API_DOCS=false`, proxy erişim kontrolü
  ve doğru `TRUST_PROXY` değerini zorunlu kabul et.

Kod kalitesi, OpenAPI ve güvenlik akışları mevcut paket içinde tamamlandı; yeni route
ve ekranlarda aynı tipli sözleşme, kapsam/RBAC ve regresyon testi standardını koru.

## Bilinen ve kabul edilmiş güvenlik sınırları

### Public ticket bağlantısı bearer yetkisidir

Public portal parola istemez. Tahmin edilemez `accessToken` bağlantısını bilen kişi
ticket'ı görebilir, yanıtlayabilir ve dosya ekleyebilir. Token kapanıştan 90 gün sonra
sona erer; bu riskin tamamını ortadan kaldırmaz.

### Token URL'lerde bulunur

Public ticket token'ı path'te; tek kullanımlık staff SSE bileti query parametresindedir.
Proxy loglarına erişim ve log saklama süresi sınırlandırılmalıdır. Staff SSE için tam
çözüm, header tabanlı kimlik taşıyabilen WebSocket benzeri bir kanaldır.

### Ticket numaraları sıralıdır

Numara tek başına erişim sağlamaz; `/public/track` e-posta eşleşmesi ve rate limit
ister. Yine de dışarıdan görülen numaralar yaklaşık ticket hacmi bilgisi verebilir.

### İç ağ varsayımı önemlidir

Sistem VPN/iç ağ arkasında tasarlanmıştır. Coolify/NPM kullanırken dahili proxy
profilindeki IP filtresi devrede değildir; eşdeğer erişim kontrolü dış proxy'de
kurulmalıdır.

## Tamamlanan önemli sertleştirmeler

- Fail-closed şirket kapsamı ve route düzeyinde RBAC testleri
- AES-256-GCM kasa ve SMTP şifreleme, TOTP MFA, oturum bazlı refresh token iptali
- MIME'dan türetilen güvenli uzantı, ek yetkilendirmesi ve ticket başına kota
- Kapanmış ticket ekleri için yapılandırılabilir retention işi
- Tek kullanımlık kısa ömürlü SSE bileti
- İç not/history sızıntısı koruması
- CSV formül enjeksiyonu, SSRF ve şablon kaçışlama korumaları
- Worker testleri, gerçek PostgreSQL/Redis entegrasyon testi ve Playwright/axe katmanı
- Zod tabanlı Fastify/OpenAPI request sözleşmeleri

## Bilinçli ürün tercihleri

- Public portalda kullanıcı hesabı/parola yoktur.
- Randevular personele atanmadığı için paralel randevu çakışma sayılmaz.
- Ayrı bir component kütüphanesi kullanılmaz; arayüz Tailwind ile proje içinde tutulur.
- Kimliksiz kullanıcı bilgi lookup özelliği PII oracle riski nedeniyle sunulmaz.
- Personel parolası en az 12 karakterdir.

Public depoda hangi dosyaların tutulacağı ve secret olayında izlenecek yol için
[public depo güvenliği](public-repo.md) belgesine bak.
