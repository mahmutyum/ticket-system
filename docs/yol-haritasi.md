# Yol Haritası ve Bilinen Eksikler

Bu doküman projenin **olduğu gibi** halini dürüstçe anlatır. Katkı vermeden veya production'a
kurmadan önce oku.

Durum: 2026-07-15 itibarıyla.

---

## Olgunluk özeti

| Alan | Durum |
|---|---|
| Özellik kapsamı | 🟢 Geniş — ticket yaşam döngüsü, SLA, raporlar, görevler, şifre kasası |
| Kurulum / deploy | 🟢 Docker Compose ile tek komut; Coolify + NPM için belgelenmiş |
| Veritabanı şema yönetimi | 🟢 Versiyonlanmış migration'lar, CI'da gerçek Postgres'e uygulanıyor |
| Dokümantasyon | 🟢 Kurulum, kullanım, mimari |
| Test | 🟡 233 test (backend 214, frontend 19) — kritik yollar korunuyor, route kapsaması kısmi |
| CI | 🟢 Tip kontrolü, lint, test, migration, Docker build, bağımlılık açıkları |
| Lint / format | 🟢 ESLint + Prettier (backend ve frontend) |
| Bağımlılık açıkları | 🟢 Production'da 0 (CI'da zorlanıyor) |
| API dokümantasyonu | 🟡 Endpoint listesi var, request/response gövdeleri yok |
| Güvenlik | 🟡 Kapsamlı bir tarama yapıldı ve bulgular kapatıldı; [kalan sınırlar](../SECURITY.md) |

---

## Öncelik 0 — Kurmadan önce doğrulanmalı

### nginx konfigürasyonu canlı test EDİLMEDİ

`frontend/nginx.conf` ve `nginx/conf.d/default.conf` içindeki ek/logo servis yolu
değiştirildi (`alias` ile diskten servis → backend'e proxy). **Değişiklik gerçek
nginx'e karşı çalıştırılamadı** — geliştirme makinesinde Docker kilitlendi.

Kanıtlanan (Docker kilitlenmeden ÖNCE, gerçek nginx konteyneriyle): eski
`frontend/nginx.conf` `/branding/...` isteğine `200 OK` + SPA'nın `index.html`'ini
döndürüyordu, yani **şirket logoları kırıktı**.

Doğrulanmayan: düzeltilmiş konfigürasyonun sözdizimi ve yönlendirmesi. Bloklar
aynı dosyada zaten çalışan `/api/` bloğunun birebir kalıbı (aynı direktifler,
`proxy_pass` sonunda eğik çizgi YOK — yol değişmeden geçsin diye), ama bu kanıt değil.

**İlk kurulumda yapılacak:**

```bash
docker compose config -q                 # compose sözdizimi
docker compose up -d --build
docker compose exec frontend nginx -t    # nginx sözdizimi
curl -sI https://<host>/branding/<companyId>/<dosya>.png   # 200 + image/png beklenir
curl -sI https://<host>/attachments/<id>                   # token'sız 404 beklenir
docker compose --profile proxy up -d     # proxy profili kullanılıyorsa
docker compose exec nginx nginx -t
```

---

## Öncelik 1 — Kalan güvenlik maddeleri

Bir güvenlik taramasının (XSS / enjeksiyon / yetkilendirme / auth) bulguları kapatıldı —
ne yapıldığı [SECURITY.md](../SECURITY.md)'de. Kapatılmayanlar:

### 1.1 SSE token'ı hâlâ URL'de (azaltıldı)

`EventSource` özel header gönderemediği için staff akışı kimliği URL'den almak zorunda.
Artık URL'de 15 dakikalık JWT değil, **30 saniye ömürlü tek kullanımlık bilet** var —
okunduğu anda siliniyor. Yani log'a düşen değer kullanıldığı anda ölü.

**Kalan:** Bilet yine de log'a yazılıyor ve 30 saniyelik bir pencerede yeniden
kullanılabilir (kullanılmadıysa). Tam çözüm SSE yerine WebSocket'e geçmek olurdu.

### 1.2 Public portalda kimlik doğrulama yok — tasarım tercihi

Erişim tahmin edilemez `accessToken` link'ine dayanıyor. Artık kapanışta süresi
doluyor (+90 gün) ve `/public/track` ile yenilenebiliyor. Ama link'i olan herkes
o ticket'ı görür — bu bilinçli bir tercih, bkz. "Bilinçli olarak yapılmayanlar".

### 1.3 Ticket numaraları sıralı

`TKT-2026-00001` biçiminde artıyor. `/public/track` ticket no + e-posta istediği ve
rate limit + `TRUST_PROXY` doğru ayarlandığı sürece sömürülebilir değil, ama sıralı
numaralar hacim bilgisi sızdırır (rakip bir firma kaç talep açıldığını tahmin edebilir).

### 1.4 Ek yükleme kotası — kapatıldı

Ticket başına **20 dosya / toplam 200 MB** sınırı kondu (`ATTACHMENT_LIMITS`).
Öncesinde yalnızca dosya başına 25 MB vardı; aynı ticket'a sınırsız ek yüklenip
disk şişirilebiliyordu.

### 1.5 Ticket ekleri hiç silinmiyor (veri saklama)

Ticket'ları silen bir uç **yok** — şirket silme bile soft delete (`isActive: false`).
Yani yetim dosya oluşmuyor, ama ekler de süresizce birikiyor. Saklama süresi
politikası (örn. kapanmış ticket'ların eklerini N ay sonra sil) tanımlı değil.

**Not:** Bu maddenin eski hali "ticket silinince dosyalar kalıyor" diyordu; yanlıştı.
Gerçek sızıntı logo değiştirmedeydi ve kapatıldı — dosya adı her yüklemede rastgele
olduğu için yeni logo eskisinin üzerine yazmıyor, eski dosya diskte kalıp `/branding`
ucundan erişilebilir olmaya devam ediyordu. `saveLogo` artık şirket klasörünü buduyor.

---

## Öncelik 2 — Test altyapısı

**Bugün: 233 test.**

Backend (214):
- `utils/staff-scope` — şirket kapsamı, fail-closed, filtre kesiştirme
- `utils/crypto` — AES-256-GCM, `looksEncrypted`
- `utils/validation` — kırpma, sınırlar, telefon/e-posta/URL, şifre politikası
- `utils/net-guard` — SSRF (IPv4/IPv6, DNS sonrası, `::ffff:` mapped)
- `utils/sla` — son tarih hesabı, tutturma, ihlal
- `utils/ticket-number` — yarış durumu, soğuk başlangıç tohumlaması
- `utils/csv-escape` — formül enjeksiyonu, çerçeveleme
- `services/sse-scope` — çapraz şirket yayın sızıntısı
- `services/email-render` — HTML kaçışlama, replacement tuzakları
- `services/storage` — uzantı türetme, SVG reddi, logo temizliği, yol kapsaması,
  shell yükleme denemeleri (18 payload: .php/.jsp/.sh, çift uzantı, null byte, traversal)
- `routes/credentials.auth` — kasa yetkilendirmesi
- `routes/staff.auth` — ayrıcalık yükseltmesi
- `routes/tickets.auth` — ticket yazma kapsamı, ek kotası
- `routes/public-leak` — iç not sızıntısı
- `routes/token-type` — token türü, geçersizleştirme
- `routes/error-handler` — handler sırası

Frontend (19): branding rengi CSS injection geçidi, sınır hizalaması.

Bulunan gerçek açıkların çoğu için **mutasyon testi** yapıldı: eski hatalı davranış geri
konduğunda testler kırılıyor.

**Kalan boşluklar:**

1. **Route kapsaması kısmi.** Kasa, personel, ticket yazma ve public sızıntı uçları
   test edildi; onsite, raporlar, şablonlar ve görevler route seviyesinde test edilmedi.
2. **Worker'lar test edilmedi** — e-posta/SMS kuyruk davranışı, retry, `failed` handler'ı.
3. **Entegrasyon testi yok.** Testler stub'lı Prisma ile çalışır; CI migration'ları
   gerçek Postgres'e uyguluyor ama uygulama testleri veritabanına dokunmuyor.
   Testcontainers ile gerçek Postgres/Redis'e karşı bir katman, Prisma sorgularının
   gerçekten doğru olduğunu kanıtlar (stub'lar `where` nesnesini doğrular, sonucu değil).
4. **Frontend'de bileşen testi yok** — yalnızca saf mantık test ediliyor.

---

## Öncelik 3 — API şemaları ve dokümantasyon

Route'lar fastify'ın `schema:` alanını kullanmıyor; validation handler içinde
`schema.parse(request.body)` ile elle yapılıyor. Sonuç: `/docs` yalnızca endpoint
listesi gösterebiliyor, request/response gövdelerini belgeleyemiyor.

**Yapılacak:** `fastify-type-provider-zod` ile mevcut Zod şemalarını fastify route
şemalarına bağla. Şemalar zaten yazılı; bağlanınca hem otomatik validation hem tam
OpenAPI dokümanı gelir ve handler'lardaki `parse` çağrıları düşer.

**Neden yapılmadı:** 17 route dosyasının tamamına dokunan bir refactor. Her handler'ın
`request.body` tipini de değiştiriyor (type provider ile çıkarım). Güvenlik
düzeltmeleriyle aynı turda yapmak, ikisinin de gözden geçirilmesini zorlaştırırdı.

---

## Öncelik 4 — Kod kalitesi

### 4.1 `Notification.channel` enum değil

Durum/öncelik/rol ve şirket grup tipi Prisma enum'u (10 enum, DB seviyesinde zorlanıyor).
`Notification.channel` bilinçli olarak `String`: e-posta/SMS şablonlarının `slug`'ıyla
eşleşir ve şablonlar veritabanından yönetilir — yeni bir şablon eklemek migration
gerektirmemeli.

### 4.2 `reports/staff-performance` personel listesini kapsamlamıyor

Kapsamlı bir `it_manager` tüm personelin adını ve rolünü görür (ticket sayıları
kapsamla doğru filtreleniyor). `GET /staff` de kimliği doğrulanmış herkese açık, yani
tutarlı — ama ikisi birlikte gözden geçirilmeli.

### 4.3 `PUT /tickets/:id` ve ek yükleme kapsamsız — kapatıldı

`GET /tickets/:id` kapsamı kontrol ediyordu, bu iki uç etmiyordu: kapsam dışı bir
ticket okunamıyor ama id'si bilindiğinde durumu/atanması değiştirilebiliyor ve
üzerine dosya eklenebiliyordu (o dosya public takip linkinden servis ediliyor).
İkisi de `isCompanyInScope` ile kapatıldı, `tests/routes/tickets.auth.test.ts`
ile korunuyor — mutasyon testinde kontrolleri kaldırmak 3 testi kırıyor.

---

## Öncelik 5 — Dokümantasyon borcu

- **Ekran görüntüsü yok.** README'de birkaç görsel, dış kullanıcının ürünü anlamasını
  ciddi biçimde hızlandırır. (Çalışan bir tarayıcı gerektirdiği için otomatik
  üretilemedi.)
- **`docs/superpowers/` klasörü** tarihsel plan/spec dokümanları içeriyor. Tamamlandı
  notu düşüldü ama uzun vadede kaldırılabilir.

---

## Bilinçli olarak yapılmayanlar

Bunlar eksik değil, **tercih**:

- **Public portalda kimlik doğrulama yok.** Talep edenin şifre hatırlaması istenmiyor;
  erişim tahmin edilemez link'e dayanıyor. Sistem iç ağda olduğu için kabul edildi.
- **Yerinde destek randevularında çakışma uyarısı yok.** Randevular personele atanmıyor,
  dolayısıyla aynı saatte paralel randevu normaldir.
- **Component kütüphanesi yok.** Frontend elle yazılmış Tailwind. Bağımlılığı azaltmak için.
- **Public ticket formunda "önceki bilgilerini getir" yok.** `/auth/lookup` kimliksiz bir
  PII oracle'ıydı; kimliği doğrulanmamış bir çağırana başkasının bilgisini döndürmenin
  güvenli yolu olmadığı için özellik kaldırıldı, uç kimlik doğrulamalı hale getirildi.
- **`min(8)` yerine 12+ karakter şifre.** Kısa şifre + sınırsız deneme, bcrypt'in
  maliyetini anlamsız kılıyordu.
