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
| **Test** | 🟡 Kritik yollar korunuyor (kapsam + crypto, 29 test); route/worker kapsaması yok |
| **CI** | 🔴 **Yok** |
| **Lint / format** | 🔴 **Yok** |
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

**Bugün:** 29 test, iki dosyada — `tests/utils/staff-scope.test.ts` (şirket kapsamı,
fail-closed, filtre kesiştirme) ve `tests/utils/crypto.test.ts` (AES-256-GCM,
`looksEncrypted`). `vitest.config.ts` ve `tsconfig.test.json` mevcut (`npm test`,
`npm run typecheck:tests`).

Bunlar birim testleridir ve yalnızca **saf mantığı** korur. **Route seviyesinde hiçbir test
yok**: `requireRole`'ün gerçekten engellediği, handler'lardaki kapsam kontrollerinin
çağrıldığı, iç notların public uçtan sızmadığı otomatik olarak doğrulanmıyor. Frontend'de
test runner yok.

**Yapılacak (öncelik sırasıyla):**

1. **Route seviyesinde auth/RBAC testleri** — en yüksek değerli boşluk. `app.inject()` ile
   Fastify'ı ayağa kaldırıp: it_manager kapsam dışı ticket'a erişebiliyor mu, kasa
   `reveal`'i 403 veriyor mu, `PUT /staff/:id/companies` it_manager'a kapalı mı.
2. **Public erişim testleri** — iç notlar public endpoint'ten sızıyor mu (regresyon riski
   yüksek), `accessToken` doğrulaması.
3. **Ticket akışı** — oluşturma, durum geçişleri, ticket numarası üretiminde yarış durumu.
4. **SLA hesabı** — kategori bazlı süre hesapları.
5. Testcontainers veya compose ile gerçek Postgres/Redis'e karşı entegrasyon testleri.

### Öncelik 3 — CI

`.github/workflows/` yok. Hiçbir şey otomatik doğrulanmıyor.

**Yapılacak:** PR'larda `tsc --noEmit` (backend + frontend), `vitest run`, `docker compose
build`. Test altyapısı olgunlaştıkça genişlet.

### Öncelik 4 — Lint / format

Ne ESLint ne Prettier var; hiçbir package.json'da `lint` script'i yok. Kod stili tutarlı ama
bunu koruyan bir mekanizma yok.

**Yapılacak:** ESLint (typescript-eslint) + Prettier ekle, CI'a bağla.

---

## Öncelik 5 — Kod kalitesi

### 5.1 API şemaları ve dokümantasyon

Route'lar fastify'ın `schema:` alanını kullanmıyor; validation handler içinde
`schema.parse(request.body)` ile elle yapılıyor. Sonuç: `/docs` yalnızca endpoint listesi
gösterebiliyor, request/response gövdelerini belgeleyemiyor.

**Yapılacak:** `fastify-type-provider-zod` gibi bir provider ile mevcut Zod şemalarını
fastify route şemalarına bağla. Tek hamlede hem otomatik validation hem tam OpenAPI dokümanı
elde edilir — şemalar zaten yazılmış durumda.

### 5.2 Prisma'da enum yok

Şemada 24 model var ama **hiç enum yok** — durum, öncelik ve roller düz `String`.
Geçerli değerler yalnızca `config/constants.ts`'de ve Zod şemalarında yaşıyor; veritabanı
seviyesinde hiçbir koruma yok.

**Yapılacak:** Ticket durumu, öncelik ve staff rolü için Prisma enum'larına geç. Veri
geçişi gerektirir.

Ayrıca `config/constants.ts` rol/durum sabitlerini tanımlar ama **hiçbir yer import etmez** —
her kontrol ham string literal. Enum'a geçerken bu da bağlanmalı; derleyici desteği
olmadığı için rol değişiklikleri gereğinden riskli.

### 5.3 Ölü konfigürasyon

`config/index.ts` `REDIS_PASSWORD`'ü zorunlu tutuyor ama backend kodu bunu **hiç okumuyor** —
Redis kimlik doğrulaması `REDIS_URL` içinde taşınıyor. Değişken yine de gerekli, çünkü
`docker-compose.yml` redis container'ını `--requirepass` ile başlatırken kullanıyor. Yani
zararsız ama okuyanı yanıltıyor.

**Yapılacak:** Zod şemasından çıkar (compose'un kullanımı etkilenmez) veya neden orada
olduğunu yorumla açıkla.

### 5.4 `PGADMIN_PASSWORD` zayıf varsayılan

`docker-compose.yml`: `${PGADMIN_PASSWORD:-changeme}`. Komşusu `DB_PASSWORD` ve
`REDIS_PASSWORD` doğru şekilde `${VAR:?}` ile fail-fast yaparken bu sessizce `changeme`'e
düşüyor. `--profile tools` opt-in olduğu için etkisi sınırlı, yine de aynı desene çekilmeli.

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
