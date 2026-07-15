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

### 1.1 SSE token'ı query parametresinde

`EventSource` özel header gönderemediği için staff canlı bildirim akışı JWT'yi query
parametresinde alır ve token proxy log'larına düşer. Access token'lar 15 dk ömürlü olduğu
için etki sınırlı. Kalıcı çözüm: kısa ömürlü tek kullanımlık SSE bileti üretmek.

### 1.2 `/docs` koşulsuz açık

Swagger UI tüm endpoint listesini gösterir. İç ağda kabul edilebilir; internete açık bir
kurulumda proxy seviyesinde kapatılmalı ya da env bayrağına bağlanmalı.

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
