# Kurulum

- [Gereksinimler](#gereksinimler)
- [Geliştirme ortamı](#geliştirme-ortamı)
- [Ortam değişkenleri](#ortam-değişkenleri)
- [Production](#production)
- [Coolify + Nginx Proxy Manager](#coolify--nginx-proxy-manager)
- [Veritabanı migration'ları](#veritabanı-migrationları)
- [Mevcut veritabanını baseline'leme](#mevcut-veritabanını-baselineleme)
- [Yerel araçlarla bağlanma](#yerel-araçlarla-bağlanma)
- [Sorun giderme](#sorun-giderme)

---

## Gereksinimler

- **Docker** ve **Docker Compose** (v2, `docker compose` komutu).
- Başka hiçbir şey gerekmez — Node.js, PostgreSQL ve Redis container içinde çalışır.
- Şifre üretmek için `openssl` (macOS/Linux'ta hazır gelir).

---

## Geliştirme ortamı

```bash
git clone https://github.com/mahmutyum/ticket-system.git
cd ticket-system
cp .env.example .env
```

`.env` içindeki `changeme_*` değerlerini doldur ([aşağıdaki tabloya](#ortam-değişkenleri) bak),
sonra:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Bu komut:
- Postgres ve Redis'i ayağa kaldırır, sağlıklı olmalarını bekler.
- Veritabanı şemasını uygular (`prisma migrate deploy`).
- Backend'i `tsx watch` ile (hot reload), frontend'i `vite` ile başlatır.
- `NODE_ENV`'i `development`'a çeker: okunabilir log, açık hata detayları.

Kaynak kodu bind-mount edilir — `backend/src` veya `frontend/src` içinde yaptığın değişiklik
container'ı yeniden başlatmadan yansır.

Örnek veriyi yükle (3 şirket, lokasyonlar, kategoriler, personel, şablonlar):

```bash
docker compose exec backend npx tsx prisma/seed.ts
```

| Adres | Ne |
|---|---|
| http://localhost:1111 | Arayüz (public portal + staff paneli) |
| http://localhost:1111/staff/login | Staff girişi |
| http://localhost:4000/docs | API endpoint listesi (Swagger UI) |
| http://localhost:4000/health/live | Process canlılık kontrolü |
| http://localhost:4000/health/ready | PostgreSQL + Redis hazır olma kontrolü |

**Seed giriş bilgileri:** `admin@company.com` / `admin123` · `manager@company.com` / `staff123` · `it@company.com` / `staff123`

> ⚠️ Seed yalnızca demo içindir. `prisma/seed.ts`'i production veritabanına karşı çalıştırma.

Durdurmak için `Ctrl+C`. Veriyi de silmek için:

```bash
docker compose down -v   # -v volume'ları da siler: veritabanı sıfırlanır
```

---

## Ortam değişkenleri

Tek doğruluk kaynağı [`.env.example`](../.env.example). Coolify kullanıyorsan bu değişkenleri
panelden yönetirsin — kod değişikliği gerekmez.

### Zorunlu — varsayılanı yok, boş bırakırsan backend açılmaz

| Değişken | Nasıl üretilir / ne yazılır |
|---|---|
| `JWT_SECRET` | `openssl rand -base64 48` — en az 32 karakter |
| `JWT_REFRESH_SECRET` | `openssl rand -base64 48` — `JWT_SECRET`'tan **farklı** olmalı |
| `CREDENTIALS_ENC_KEY` | `openssl rand -hex 32` — **tam 64 hex karakter** |
| `DB_PASSWORD` | Serbest. `DATABASE_URL` içine de aynısını yaz. |
| `REDIS_PASSWORD` | Serbest. `REDIS_URL` içine de aynısını yaz. |
| `DATABASE_URL` | `postgresql://<DB_USER>:<DB_PASSWORD>@postgres:5432/<DB_NAME>` |
| `REDIS_URL` | `redis://:<REDIS_PASSWORD>@redis:6379` |
| `APP_URL` | Sistemin erişileceği FQDN. Birden fazlaysa virgülle ayır. |
| `SMTP_HOST` `SMTP_USER` `SMTP_PASS` `SMTP_FROM` | Global SMTP. Zod bunları zorunlu tutar; e-posta göndermeyeceksen bile bir değer yazılmalı. |

> **`CREDENTIALS_ENC_KEY` hakkında:** Şifre kasasındaki (`/staff/passwords`) kayıtları
> AES-256-GCM ile şifreler. **Bu anahtarı kaybedersen veya değiştirirsen kasadaki tüm
> şifreler kalıcı olarak çözülemez hale gelir.** Ayrıca doğrulama yalnızca uzunluğa bakar,
> hex karakter kümesini de açılışta doğrular. Değeri `openssl rand -hex 32` ile üret.

> **`REDIS_PASSWORD` neden iki yerde?** Hem `redis` container'ı `--requirepass` ile
> başlatılırken hem de `REDIS_URL` içinde kullanılır. İkisi farklıysa backend Redis'e
> bağlanamaz. Aynı durum `DB_PASSWORD` / `DATABASE_URL` için de geçerli.

> **`APP_URL` ve CORS:** Virgülle ayrılmış liste alır. **İlk değer canonical sayılır** ve
> e-posta içindeki takip linklerinde kullanılır; **listenin tamamı** CORS whitelist'ine
> eklenir. Örn: `APP_URL=https://ticket.firma.com,https://destek.firma.com`

### Varsayılanı olan backend değişkenleri

| Değişken | Varsayılan | Ne işe yarar |
|---|---|---|
| `NODE_ENV` | `development` | `production`: JSON log, 500 hata detayları gizlenir |
| `PORT` | `4000` | Backend'in container içinde dinlediği port |
| `APP_NAME` | `IT Destek Sistemi` | Uygulama adı |
| `ACCESS_TOKEN_EXPIRY` | `15m` | Access token ömrü |
| `REFRESH_TOKEN_EXPIRY` | `7d` | Refresh token ömrü |
| `SMTP_PORT` | `587` | |
| `SMTP_SECURE` | `false` | `true` ise TLS (genelde port 465) |
| `MAX_FILE_SIZE` | `26214400` (25 MB) | Dosya ekleme üst sınırı |
| `UPLOAD_DIR` | `/app/uploads` | Container içi yükleme dizini (volume'a bağlı) |
| `SMS_GATEWAY_URL` `SMS_GATEWAY_API_KEY` `SMS_SENDER` | — | Opsiyonel. Boşsa SMS gönderilmez. |

### Yalnızca Docker Compose'un kullandığı değişkenler

| Değişken | Varsayılan | Ne işe yarar |
|---|---|---|
| `FRONTEND_PORT` | `1111` | Host'a açılan tek port. NPM buraya forward eder. |
| `DB_NAME` | `ticketdb` | |
| `DB_USER` | `ticket` | |
| `BACKEND_PORT` `DB_PORT` `REDIS_PORT` | `4000` `5432` `6379` | Sadece `docker-compose.local.yml` aktifken host'a açılır |
| `NGINX_HTTP_PORT` `NGINX_HTTPS_PORT` | `80` `443` | Sadece `--profile proxy` ile |
| `PGADMIN_PORT` `PGADMIN_EMAIL` `PGADMIN_PASSWORD` | `5050` … | Sadece `--profile tools` ile |

---

## Production

```bash
cp .env.example .env      # değerleri doldur
docker compose up -d --build
```

Ne olur:
- `backend` imajı derlenir, açılışta `prisma migrate deploy` çalışır, sonra `node dist/server.js`.
- Yalnızca `frontend` host'a açılır (`FRONTEND_PORT`). `backend`, `postgres`, `redis` sadece
  dahili `app-network` üzerindedir — host'a **expose edilmez**.
- `uploads` ve `pgdata` isimli volume'lar veriyi kalıcı tutar.

Production için `.env`'de mutlaka:
- `NODE_ENV=production`
- `APP_URL` gerçek FQDN(ler)in
- Tüm `changeme_*` değerleri gerçek, rastgele üretilmiş değerlerle değiştirilmiş

Dahili nginx proxy'ye ihtiyacın varsa (NPM/Coolify yoksa):

```bash
docker compose --profile proxy up -d --build
```

Bu profil `nginx/conf.d/default.conf`'u kullanır: HTTP→HTTPS yönlendirme, TLS 1.2/1.3,
rate limiting ve **RFC1918 özel ağlarla sınırlı IP whitelist** (dışarıdan gelen istek 403 alır).
`server_name` ve VPN subnet'lerini kendi ortamına göre düzenle. `nginx/Dockerfile` build
sırasında **self-signed** sertifika üretir — gerçek kurulumda kendi sertifikanla değiştir.

---

## Coolify + Nginx Proxy Manager

```
İnternet/VPN → NPM (SSL + FQDN) → frontend:1111 ─┬─ /          → SPA
                                                  ├─ /api/*     → backend:4000
                                                  └─ /uploads/* → backend:4000
```

1. Coolify'da repoyu ekle — `docker-compose.yml` otomatik algılanır.
2. Tüm `.env` değişkenlerini Coolify environment panelinden gir.
3. NPM'de proxy host oluştur:
   - **Domain Names:** `ticket.firma.com` (birden fazla yazılabilir)
   - **Scheme:** `http` · **Forward Hostname/IP:** Coolify host IP'si · **Forward Port:** `FRONTEND_PORT` (`1111`)
   - **Websockets Support: ON** — SSE (canlı güncelleme) için **zorunlu**
   - **Block Common Exploits:** ON
   - **SSL:** Let's Encrypt veya kendi sertifikan · **Force SSL:** ON · **HTTP/2:** ON
4. `APP_URL`'e NPM'de tanımladığın FQDN'lerin **tamamını** virgülle ayırarak yaz — aksi halde
   CORS istekleri reddeder.

Backend `trustProxy: true` ile çalışır: NPM'in `X-Forwarded-For/Proto/Host` header'ları
rate-limit ve audit log'da gerçek client IP olarak kullanılır.

---

## Veritabanı migration'ları

Şema `backend/prisma/schema.prisma`'da, versiyonlanmış migration'lar
`backend/prisma/migrations/` altında tutulur.

- **Açılışta otomatik:** hem dev hem production compose'u `prisma migrate deploy` çalıştırır.
  Idempotent'tir — uygulanmış migration'ları atlar, her restart'ta güvenle çalışır.
- **Şema değiştirdiğinde yeni migration üret:**

  ```bash
  docker compose exec backend npx prisma migrate dev --name aciklayici_bir_ad
  ```

  Üretilen SQL'i **incele** ve commit'e dahil et.

> `prisma db push` **kullanma.** Migration geçmişini atlar ve `--accept-data-loss` ile
> sessizce kolon/tablo düşürebilir. Bu proje daha önce bu yöntemi kullanıyordu; artık
> versiyonlanmış migration'lara geçti.

### Mevcut veritabanını baseline'leme

`prisma db push` ile oluşturulmuş, hâlihazırda **çalışan** bir veritabanın varsa,
`migrate deploy` şunu der:

```
Error: P3005 The database schema is not empty.
```

Çünkü Prisma tabloları görüyor ama uygulanmış hiçbir migration kaydı bulamıyor. Bir kereye
mahsus baseline gerekir.

**1. Önce şemanın gerçekten eşleştiğini doğrula.** Çıktı boşsa veritabanın `0_init` ile
birebir aynıdır:

```bash
docker compose exec backend npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script
```

**2. Çıktı boşsa** `0_init`'i uygulanmış olarak işaretle (SQL çalıştırmaz, sadece kaydeder):

```bash
docker compose exec backend npx prisma migrate resolve --applied 0_init
```

**3. Çıktı boş değilse** veritabanın şemadan sapmış demektir. Yukarıdaki SQL aradaki farktır —
**otomatik uygulama.** İncele, gerekiyorsa yedek al, sonra elle uygula veya bir migration'a
dönüştür. Şüphedeysen önce bir kopya üzerinde dene.

> Baseline'dan önce **veritabanı yedeği al**:
> `docker compose exec postgres pg_dump -U ticket ticketdb > yedek.sql`

---

## Yerel araçlarla bağlanma

DBeaver, RedisInsight gibi araçlarla bağlanmak için Postgres/Redis'i **yalnızca
`127.0.0.1`'e** açan override'ı kullan:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
```

| Servis | Adres |
|---|---|
| Postgres | `127.0.0.1:5432` |
| Redis | `127.0.0.1:6379` |
| Backend | `127.0.0.1:4000` |

PgAdmin'i tercih edersen:

```bash
docker compose --profile tools up -d pgadmin   # http://localhost:5050
```

> ⚠️ `docker-compose.local.yml`'i **production'da kullanma** — veritabanını host ağına açar.

---

## Sorun giderme

**Backend açılır açılmaz kapanıyor, log'da `Invalid environment variables`**
Zod doğrulaması başarısız. Log hangi değişkenin sorunlu olduğunu yazar. En sık sebep:
`CREDENTIALS_ENC_KEY` eksik veya 64 karakter değil, ya da `JWT_SECRET` 32 karakterden kısa.

**`CREDENTIALS_ENC_KEY 64 karakterlik hex olmalı`**
`openssl rand -hex 32` ile üret. Tırnak veya boşluk kalmadığından emin ol.

**Şifre kasasında `Invalid key length` / şifre çözülemiyor**
`CREDENTIALS_ENC_KEY` 64 karakter ama geçerli hex değil (doğrulama sadece uzunluğa bakar),
ya da kayıtlar farklı bir anahtarla şifrelenmiş. Eski anahtar kaybolduysa o kayıtlar
kurtarılamaz.

**`P3005 The database schema is not empty`**
[Mevcut veritabanını baseline'leme](#mevcut-veritabanını-baselineleme) bölümüne bak.

**Backend Redis'e bağlanamıyor**
`REDIS_PASSWORD` ile `REDIS_URL` içindeki şifre farklı. Aynı olmalı. Aynı kontrolü
`DB_PASSWORD` / `DATABASE_URL` için de yap.

**Tarayıcıda CORS hatası**
`APP_URL`, siteye eriştiğin FQDN'i içermiyor. Virgülle ayırarak ekle ve backend'i yeniden
başlat.

**Panelde canlı güncelleme (SSE) gelmiyor**
NPM proxy host'unda **Websockets Support: ON** olmalı. Araya giren başka bir proxy varsa
response buffering'i kapatmalı.

**Frontend açılıyor ama API 502**
Backend healthcheck'i geçemiyor. `docker compose logs backend` ile bak — genelde migration
veya env hatası.

**Dosya yükleme 413 hatası**
Yükleme `MAX_FILE_SIZE`'ı (varsayılan 25 MB) veya nginx `client_max_body_size`'ı
(`frontend/nginx.conf`, 25M) aşıyor. İkisini birlikte artır.
