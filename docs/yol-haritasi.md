# Yol Haritası ve Bilinen Eksikler

Bu doküman projenin **olduğu gibi** halini dürüstçe anlatır. Katkı vermeden veya production'a
kurmadan önce oku.

Durum: 2026-07-15 itibarıyla.

---

## Olgunluk özeti

| Alan | Durum |
|---|---|
| Özellik kapsamı | 🟢 Geniş — ticket yaşam döngüsü, SLA, raporlar, görevler, şifre kasası çalışır durumda |
| Kurulum / deploy | 🟢 Docker Compose ile tek komut; Coolify + NPM için belgelenmiş |
| Veritabanı şema yönetimi | 🟢 Versiyonlanmış migration'lar |
| Dokümantasyon | 🟢 Kurulum, kullanım, mimari |
| **Test** | 🟡 Kapsam, crypto ve route seviyesi auth korunuyor (52 test); ticket/SLA/worker kapsaması yok |
| **CI** | 🟢 GitHub Actions — tip kontrolü, lint, test, migration ve Docker build |
| **Lint / format** | 🟢 ESLint + Prettier (backend ve frontend) |
| API dokümantasyonu | 🟡 Endpoint listesi var, request/response gövdeleri yok |
| Güvenlik | 🟡 Yetkilendirme sertleştirildi, [bilinen sınırlar](../SECURITY.md) sürüyor |

---

## Öncelik 1 — Güvenlik

Aşağıdakiler bir güvenlik taramasında (XSS/enjeksiyon/yetkilendirme) bulundu ve
**kapatılmadı** — kapatılanlar için [SECURITY.md](../SECURITY.md).

### 1.1 `/uploads` kimlik doğrulaması yapmıyor

Ekler statik servis edilir; API kapsamı doğru uyguluyor ama dosyanın kendisi için
token gerekmez. Yol tahmin edilemez ama bu yetkilendirme değil, gizlilik-by-URL:
link bir kez sızarsa (proxy log'u, tarayıcı geçmişi, e-posta) erişim kalıcıdır ve
ticket kapandıktan sonra da sürer.

**Yapılacak:** `/uploads` statik servisini kaldır; `Attachment` → `ticketId` →
`companyId` çözen ve staff kapsamı VEYA eşleşen `accessToken` kontrolü yapan
kimlik doğrulamalı bir route ekle.

### 1.2 Public `accessToken` süresiz ve URL yolunda

Süresi dolmaz, döndürülmez, ticket kapanınca iptal edilmez. URL YOLUNDA olduğu için
nginx `access_log`'una tam yazılır.

**Yapılacak:** TTL + kapanışta iptal; token'ı yoldan çıkar (POST gövdesi veya
fragment) ya da `log_format`'ta maskele. `GET /public/ticket/:token` ayrıca kapalı
ticket'ları okumaya izin veriyor — `resolved`/`closed` kontrolü upload yolunda var
ama okuma yolunda yok.

### 1.3 `POST /auth/lookup` kimliksiz PII oracle'ı

Herhangi bir e-posta için `{id, email, fullName, companyId}` döndürüyor. Ticket
numaraları sıralı (`TKT-2026-00001`), yani `/public/track` ile zincirlenip
accessToken hasat edilebilir.

**Yapılacak:** Kimlik doğrulaması iste ya da yalnızca boolean döndür.

### 1.4 JWT'de `type` claim'i yok

Access ve refresh token'ların payload'ı birebir aynı; ayrım YALNIZCA farklı
secret'lara dayanıyor ve bu ayrım zorlanmıyor (`.refine` yok). Operatör ikisini aynı
verirse 7 günlük refresh cookie'si access token olarak geçerli olur.

**Yapılacak:** `type: 'access' | 'refresh'` claim'i ekle ve doğrulamada zorla;
ayrıca env şemasına `JWT_SECRET !== JWT_REFRESH_SECRET` refine'ı koy.

### 1.5 Access token'da rol/aktiflik yeniden kontrol edilmiyor

`authenticate` saf JWT doğrulaması yapar, DB'ye bakmaz. Rol düşürülen bir kullanıcı
15 dakika boyunca eski rolüyle çalışmaya devam eder; `PUT /staff/:id` yalnızca şifre
değişiminde token iptal ediyor.

### 1.6 SMTP yapılandırması SSRF'e açık (admin)

`POST /companies/:id/smtp/test` host/port doğrulamadan bağlanır ve hata metnini
çağırana döndürür — yarı-kör SSRF + port tarayıcı. Dahili ağ (`redis:6379`,
`postgres:5432`) ve bulut metadata uçları erişilebilir. Şu an yalnızca `admin`
yazabiliyor; **`it_manager`'a açılırsa yüksek önceliğe çıkar.**

**Yapılacak:** DNS çözümlemesinden SONRA private/link-local CIDR blocklist'i.

### 1.7 Şifre politikası ve lockout yok

`min(8)`, karmaşıklık/breach kontrolü yok, hesap kilitleme yok, başarısız giriş
audit kaydı yok.

### 1.8 SSE token'ı query parametresinde

`EventSource` özel header gönderemediği için staff canlı bildirim akışı JWT'yi query
parametresinde alır ve token proxy log'larına düşer. Access token'lar 15 dk ömürlü olduğu
için etki sınırlı. Kalıcı çözüm: kısa ömürlü tek kullanımlık SSE bileti üretmek.

### 1.9 Tek oturum sınırı

Redis'te personel başına tek `refresh:<staffId>` anahtarı var: B cihazında giriş
yapmak A'nınkini sessizce öldürüyor, B'de çıkış A'yı da düşürüyor. Güvenlik açığı
değil, kullanılabilirlik hatası (laptop + telefon normal bir senaryo).

---

## Öncelik 2 — Test altyapısı

**Bugün:** 52 test, dört dosyada.

- `tests/utils/staff-scope.test.ts` — şirket kapsamı, fail-closed, filtre kesiştirme.
- `tests/utils/crypto.test.ts` — AES-256-GCM, `looksEncrypted`.
- `tests/routes/credentials.auth.test.ts` — kasa yetkilendirmesi `app.inject()` ile:
  kapsam dışı/global kayıt 403, reddedilen `reveal` audit log yazmıyor.
- `tests/routes/staff.auth.test.ts` — şirket atamasında ayrıcalık yükseltmesi kapalı.

Bulunan iki gerçek açık için **mutasyon testi** yapıldı: eski hatalı davranış geri
konduğunda testler kırılıyor, yani dekoratif değiller.

**Kalan boşluklar (öncelik sırasıyla):**

1. **Public erişim testleri** — iç notlar public endpoint'ten sızıyor mu (regresyon riski
   yüksek), `accessToken` doğrulaması.
2. **Ticket akışı** — oluşturma, durum geçişleri, ticket numarası üretiminde yarış durumu.
3. **SLA hesabı** — kategori bazlı süre hesapları.
4. **Worker'lar** — e-posta/SMS kuyruk davranışı, retry.
5. Testcontainers ile gerçek Postgres/Redis'e karşı entegrasyon testleri. (CI şu an
   migration'ları gerçek Postgres'e uyguluyor ama uygulama testleri stub'lı.)
6. **Frontend'de test runner yok.**

### Öncelik 3 — CI ve lint ✅

`.github/workflows/ci.yml` dört iş çalıştırır: backend (tip kontrolü + testler + lint),
frontend (tip kontrolü + lint + build), migration'lar (gerçek Postgres'e `migrate deploy`,
şema-DB örtüşme kontrolü, seed) ve Docker imaj build'leri.

ESLint + Prettier her iki pakette kurulu (`npm run lint`, `npm run format`). Kurulum
**gerçek hata** yakalamaya ayarlı, stil dayatmaya değil: biçim kuralları Prettier'a
bırakılmış, `no-explicit-any` uyarı seviyesinde (kod tabanında bilinçli `any` var),
`require-await` kapalı (Fastify handler'ları sözleşme gereği async).

---

## Öncelik 5 — Kod kalitesi

### 5.1 API şemaları ve dokümantasyon

Route'lar fastify'ın `schema:` alanını kullanmıyor; validation handler içinde
`schema.parse(request.body)` ile elle yapılıyor. Sonuç: `/docs` yalnızca endpoint listesi
gösterebiliyor, request/response gövdelerini belgeleyemiyor.

**Yapılacak:** `fastify-type-provider-zod` gibi bir provider ile mevcut Zod şemalarını
fastify route şemalarına bağla. Tek hamlede hem otomatik validation hem tam OpenAPI dokümanı
elde edilir — şemalar zaten yazılmış durumda.

### 5.2 Enum'a çevrilmeyen iki alan

Durum/öncelik/rol artık Prisma enum'u (9 enum, DB seviyesinde zorlanıyor). İki alan
bilinçli olarak `String` bırakıldı:

- **`Company.groupType`** — yazma yolu uzun süre `z.string().min(1)` ile doğrulandı, yani
  mevcut veritabanlarında listenin dışında değerler bulunabilir; enum migration'ı
  `ALTER ... USING` sırasında patlardı. Önce veri temizlenmeli:
  `SELECT DISTINCT group_type FROM companies;`
- **`Notification.channel`** — e-posta/SMS şablonlarının `slug`'ıyla eşleşir ve şablonlar
  veritabanından yönetilir; yeni şablon eklemek migration gerektirmemeli.

---

## Öncelik 6 — Dokümantasyon borcu

- **`Progression.md` bayat.** Faz listesi Mayıs'ta kalmış; görev yönetimi ve şifre kasası
  yansımamış. Ya güncelle ya da kaldır — bu yol haritası onun yerini alabilir.
- **`docs/superpowers/plans/2026-06-26-takvim-ve-sifreler.md` bayat.** Tüm checkbox'lar
  işaretsiz ama **kod tamamen yazılmış** durumda. Tarihsel kayıt olarak tutulacaksa başına
  "tamamlandı" notu düşülmeli.
- **Ekran görüntüsü yok.** README'de birkaç görsel, dış kullanıcının ürünü anlamasını
  ciddi biçimde hızlandırır.

---

## Bilinçli olarak yapılmayanlar

Bunlar eksik değil, **tercih**:

- **Public portalda kimlik doğrulama yok.** Talep edenin şifre hatırlaması istenmiyor;
  erişim tahmin edilemez link'e dayanıyor. Sistem iç ağda olduğu için kabul edildi.
- **Yerinde destek randevularında çakışma uyarısı yok.** Randevular personele atanmıyor,
  dolayısıyla aynı saatte paralel randevu normaldir. Uyarı bilinçli olarak kaldırıldı.
- **Component kütüphanesi yok.** Frontend elle yazılmış Tailwind. Bağımlılığı azaltmak için.
