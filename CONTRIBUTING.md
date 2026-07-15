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

Bu proje henüz CI'sız. **Kontroller senin sorumluluğunda:**

```bash
# Backend
cd backend
npx tsc --noEmit          # tip kontrolü
npx vitest run            # testler

# Frontend
cd ../frontend
npx tsc -b                # tip kontrolü
```

Docker imajlarının hâlâ derlendiğinden emin ol:

```bash
docker compose build
```

---

## Kodlama kuralları

- **Backend ESM'dir.** Göreli import'larda **`.js` uzantısı zorunlu** — kaynak dosya `.ts`
  olsa bile: `import { foo } from './foo.js'`. Unutursan çalışma zamanında patlar, `tsc`
  yakalamaz.
- **Tüm input Zod ile doğrulanır.**
- **API yanıtı:** `{ success: boolean, data?: T, error?: string }`.
- **Türkçe** hata mesajları ve UI label'ları.
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
| `plugins/auth.ts`, `utils/staff-scope.ts` | Auth ve şirket kapsamı. Test edilmemiş — regresyon sessizce geçer. |
| `modules/tickets/public.routes.ts` | Kimlik doğrulaması olmayan yüzey. İç notlar buradan **asla** sızmamalı. |
| `utils/crypto.ts`, `modules/credentials/` | Şifre kasası. Şifreleme formatını değiştirmek mevcut kayıtları **okunamaz** hale getirir. |
| `modules/notes/` | `isInternal` filtresi. |

Güvenlik açığı bulduysan **issue açma** — [SECURITY.md](SECURITY.md)'deki yolu izle.

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

[Yol haritasındaki](docs/yol-haritasi.md) yüksek değerli ve nispeten bağımsız işler:

- **Test altyapısı** — `vitest.config.ts` eklemek ve auth/RBAC testleri yazmak en yüksek
  etkili katkı. Şu an 3 test var, hepsi crypto util'inde.
- **CI** — `tsc --noEmit` + `vitest run` + `docker compose build` çalıştıran bir GitHub
  Actions workflow'u.
- **ESLint + Prettier** kurulumu.
- **Zod → fastify şema entegrasyonu** (`fastify-type-provider-zod`) — şemalar zaten yazılı;
  bağlanınca `/docs` tam OpenAPI dokümanına dönüşür.
- **Ticket/görev önceliği tutarsızlığı** (`critical` vs `urgent`).
- **Ekran görüntüleri** — README'yi ciddi biçimde iyileştirir.
