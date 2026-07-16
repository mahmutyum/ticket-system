# Katkı Rehberi

Katkılar memnuniyetle karşılanır. Başlamadan önce [docs/yol-haritasi.md](docs/yol-haritasi.md)
dosyasını oku — bilinen eksikler ve öncelikler orada.

---

## Başlangıç

```bash
git clone https://github.com/mahmutyum/ticket-system.git
cd ticket-system
cp .env.example .env         # değerleri doldur — bkz. docs/kurulum.md
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
docker compose exec backend npx tsx prisma/seed.ts
```

Detay ve sorun giderme: [docs/kurulum.md](docs/kurulum.md).

Kod tabanının teknik özeti için [docs/mimari.md](docs/mimari.md).

---

## Değişiklik göndermeden önce

CI (`.github/workflows/ci.yml`) PR'larda hepsini çalıştırır, ama yerelde geçirmek zamandan
kazandırır:

```bash
# Backend
cd backend
npm run typecheck         # kaynak tip kontrolü
npm run typecheck:tests   # test dosyaları (ayrı tsconfig — ana build rootDir:src)
npm run lint
npm test

# Frontend
cd ../frontend
npm run typecheck
npm run lint
npm run build
```

CI ayrıca migration'ları **gerçek bir Postgres'e** uygular ve şemanın veritabanıyla
örtüştüğünü doğrular — şemayı değiştirip migration üretmeyi unutursan orada yakalanır.

---

## Kodlama kuralları

- **Backend ESM'dir.** Göreli import'larda **`.js` uzantısı zorunlu** — kaynak dosya `.ts`
  olsa bile: `import { foo } from './foo.js'`. Unutursan çalışma zamanında patlar, `tsc`
  yakalamaz.
- **Tüm input Zod ile doğrulanır.**
- **API yanıtı:** `{ success: boolean, data?: T, error?: string }`.
- **Çift dil (TR/EN).** Kullanıcıya görünen metin hardcode edilmez: frontend
  `react-i18next` (`i18n/locales` + sayfa bazlı `i18n/pages`), backend API mesajları
  `i18n/messages/*` + `t(request, key)` (Accept-Language). tr = orijinal, en = çeviri.
- Durum/öncelik/rol sabitleri `backend/src/config/constants.ts`'de — string literal
  serpiştirme.
- Admin/staff CRUD işlemlerinde `createAuditLog()` çağır.
- Frontend: dosya başına bir component, veri çekme TanStack Query ile.
- Mevcut kodun stiline uy. Lint/format aracı henüz yok, tutarlılık elle sağlanıyor.

---

## Veritabanı değişiklikleri

Şemayı değiştirdiysen migration üret ve **commit'e dahil et**:

```bash
docker compose exec backend npx prisma migrate dev --name aciklayici_bir_ad
```

Üretilen SQL'i **oku**. Kolon veya tablo düşüren bir migration açtıysan PR açıklamasında
belirt.

> **`prisma db push` kullanma.** Migration geçmişini atlar. Proje bilinçli olarak
> versiyonlanmış migration'lara geçti.

---

## Güvenlik hassasiyeti olan alanlar

Bu dosyalara dokunuyorsan ekstra dikkat ve PR açıklamasında gerekçe:

| Alan | Neden |
|---|---|
| `plugins/auth.ts`, `utils/staff-scope.ts` | Auth ve şirket kapsamı. Testli (`tests/utils/staff-scope`, `tests/routes/management-scope`) ama sessiz regresyon riski yüksek — değişince testleri de gözden geçir. |
| `modules/tickets/public.routes.ts` | Kimlik doğrulaması olmayan yüzey. İç notlar buradan **asla** sızmamalı. |
| `utils/crypto.ts`, `modules/credentials/` | Şifre kasası. Şifreleme formatını değiştirmek mevcut kayıtları **okunamaz** hale getirir. |
| `modules/notes/` | `isInternal` filtresi. |

Güvenlik açığı bulduysan **issue açma** — [SECURITY.md](SECURITY.md)'deki yolu izle.

Repoya neyin girip girmeyeceği (secret, gerçek veri, PII, üretim görüntüsü) ve commit
öncesi kontrol için: [docs/public-repo.md](docs/public-repo.md).

---

## Commit ve PR

- Commit mesajları açıklayıcı olsun. `feat(kapsam): ...`, `fix(kapsam): ...` biçimi tercih
  edilir. Türkçe veya İngilizce, ikisi de olur.
- **`Co-Authored-By` satırı kullanılmaz.**
- PR açıklamasında: ne değişti, neden, nasıl test ettin. Şema değişikliği veya davranış
  değişikliği varsa açıkça belirt.
- Küçük ve odaklı PR'lar daha hızlı ilerler.

---

## Nereden başlamalı

[Yol haritasındaki](docs/yol-haritasi.md) nispeten bağımsız işler:

- **"Taleplerim" görünümü** — talep sahibinin e-posta doğrulamalı, birleşik talep listesi
  (yol haritasında akış tarif edildi). Yeni bir public sayfa + kısa ömürlü doğrulama akışı.
- **Test kapsamını genişlet** — özellikle kapsam/RBAC ve public yüzey senaryoları; mevcut
  örnekler `tests/routes/` altında.
- **Erişilebilirlik ve UX** — Playwright/axe senaryolarını genişlet.
