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
| **Test** | 🔴 **Neredeyse yok — 3 test, yalnızca crypto util** |
| **CI** | 🔴 **Yok** |
| **Lint / format** | 🔴 **Yok** |
| API dokümantasyonu | 🟡 Endpoint listesi var, request/response gövdeleri yok |
| Güvenlik | 🟡 Temeller sağlam, [bilinen sınırlar](../SECURITY.md) var |

---

## Öncelik 1 — Güvenlik

### 1.1 Şirket SMTP şifrelerini şifrele

`CompanySmtp.pass` düz metin saklanıyor; şemadaki `// encrypted in production` yorumu
gerçeği yansıtmıyor (`companies.routes.ts` `body.pass`'i ham yazıyor).

**Yapılacak:** `utils/crypto.ts` zaten var ve AES-256-GCM sunuyor — şifre kasası için
kullanılıyor. Aynı `encrypt`/`decrypt` fonksiyonlarını `CompanySmtp.pass` için de kullan.
Mevcut düz metin kayıtları için bir migration script'i gerekir. Şema yorumu düzeltilmeli.

### 1.2 `it_staff` kapsamını fail-closed yap

`utils/staff-scope.ts`: şirket ataması olmayan `it_staff` şu an **tüm** şirketleri görüyor.

**Yapılacak:** Varsayılanı tersine çevir — atama yoksa **hiçbir şey** görmesin. Geriye dönük
uyumluluk için mevcut atamasız hesapları tespit edip bilinçli olarak tüm şirketlere ata veya
`admin`/`it_manager`'a yükselt. Bu değişiklik veri geçişi gerektirir, dikkatli planla.

> Bu madde planlanan rol sistemi güncellemesiyle birlikte ele alınacak.

### 1.3 Seed'i production'a karşı kilitle

`prisma/seed.ts` `NODE_ENV` kontrolü yapmıyor ve `admin123` ile bir `admin` hesabı açıyor.

**Yapılacak:** Başına `NODE_ENV === 'production'` ise hata verip çıkan bir guard ekle
(`--force` bayrağıyla bilinçli olarak aşılabilsin).

### 1.4 CSP'yi aç

`app.ts` — `contentSecurityPolicy: false`. Vite build'inin ürettiği asset'lere uygun bir
politika yazılmalı.

---

## Öncelik 2 — Test altyapısı

**Bugün:** `backend/tests/utils/crypto.test.ts` — 3 test. Başka hiçbir şey. Route'lar, auth,
RBAC, şirket kapsamı, SLA hesabı ve worker'lar **tamamen test edilmemiş**. Frontend'de test
runner bile yok.

Ayrıca: `vitest.config.ts` yok ve `backend/tsconfig.json` `tests` dizinini `exclude`
ediyor — yani test dosyaları `tsc` ile tip kontrolünden geçmiyor.

**Yapılacak (öncelik sırasıyla):**

1. `vitest.config.ts` ekle; `tsconfig.json`'ın `exclude`'undan `tests`'i çıkar.
2. **Auth ve RBAC testleri** — en yüksek değerli alan. `requireRole` gerçekten engelliyor mu,
   `it_staff` kendi kapsamı dışını görebiliyor mu, refresh token iptali çalışıyor mu.
3. **Public erişim testleri** — iç notlar public endpoint'ten sızıyor mu (regresyon riski
   yüksek), `accessToken` doğrulaması.
4. **Ticket akışı** — oluşturma, durum geçişleri, ticket numarası üretiminde yarış durumu.
5. **SLA hesabı** — kategori bazlı süre hesapları.
6. Testcontainers veya compose ile gerçek Postgres/Redis'e karşı entegrasyon testleri.

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

> Rol sistemi güncellemesi bu maddeyi de kapsayabilir.

### 5.3 Ticket ve görev öncelikleri tutarsız

Ticket öncelikleri: `low`/`medium`/`high`/**`critical`**.
Görev öncelikleri: `low`/`medium`/`high`/**`urgent`**.

Aynı kavram, iki farklı sözcük. Kafa karıştırıcı; birleştirilmeli.

### 5.4 Ölü konfigürasyon

`config/index.ts` `REDIS_PASSWORD`'ü zorunlu tutuyor ama backend kodu bunu **hiç okumuyor** —
Redis kimlik doğrulaması `REDIS_URL` içinde taşınıyor. Değişken yine de gerekli, çünkü
`docker-compose.yml` redis container'ını `--requirepass` ile başlatırken kullanıyor. Yani
zararsız ama okuyanı yanıltıyor.

**Yapılacak:** Zod şemasından çıkar (compose'un kullanımı etkilenmez) veya neden orada
olduğunu yorumla açıkla.

### 5.5 `PGADMIN_PASSWORD` zayıf varsayılan

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
