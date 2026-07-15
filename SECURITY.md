# Güvenlik

## Açık bildirimi

Bir güvenlik açığı bulursan **public issue açma.** GitHub üzerinden
[Security Advisory](https://github.com/mahmutyum/ticket-system/security/advisories/new)
oluştur veya depo sahibiyle özel iletişime geç.

---

## Tasarım varsayımı: iç ağ

Bu sistem **VPN / iç ağ arkasında** çalışmak üzere tasarlandı. Aşağıdaki kararlar bu
varsayıma dayanır ve sistemi doğrudan internete açarsan **geçerliliğini yitirir**:

- **Public portal kimlik doğrulaması yapmaz.** Erişim, tahmin edilemez bir `accessToken`
  (nanoid) link'ine dayanır — link'i olan herkes o ticket'ı görür, yanıtlar ve dosya ekler.
  Link sızarsa ticket sızar.
- **Dahili nginx (`--profile proxy`) IP whitelist'i RFC1918 + loopback ile sınırlıdır**;
  dışarıdan gelen istekleri 403 ile reddeder. Bu profili kullanmıyorsan (Coolify/NPM
  senaryosu) bu koruma **yoktur** — erişim kontrolünü kendi proxy'nde sağlamalısın.

---

## Bilinen güvenlik sınırları

Bunlar bilinen ve kabul edilmiş sınırlardır. Kurmadan önce oku.

### Eski kurulumlarda SMTP şifreleri düz metin kalmış olabilir

`CompanySmtp.pass` artık AES-256-GCM ile şifrelenir. Ancak şifreleme sonradan eklendi:
**bu sürümden önce kaydedilmiş şirket SMTP şifreleri veritabanında düz metin durur.**
Okuma yolu bunları formatından tanıyıp çalışmaya devam eder ve log'a uyarı basar.

**Yapman gereken (tek seferlik):**

```bash
docker compose exec backend npm run db:encrypt-smtp
```

Idempotent'tir, tekrar çalıştırılabilir. Öncesinde veritabanı yedeği al.

### SSE token'ı query parametresinde

Tarayıcının `EventSource` API'si özel header gönderemediği için, staff canlı bildirim
akışı JWT'yi query parametresinde alır: `/events/staff?token=<JWT>`.

**Etkisi:** Token nginx `access_log`'una ve araya giren her proxy'nin log'una yazılır.

**Sınırlayıcı faktör:** Access token'lar 15 dakika ömürlüdür. Yine de log'lara erişimi olan
biri kısa süreli oturum ele geçirebilir.

**Geçici önlem:** Proxy log'larına erişimi kısıtla, log rotasyonunu ve saklama süresini sıkı tut.

### Seed demo şifreleri

`backend/prisma/seed.ts` geliştirme ortamında `admin@company.com` / `admin123` hesabını
`admin` rolüyle oluşturur (ayrıca `staff123` ile iki hesap daha).

Seed artık production'a karşı çalışmayı **reddeder**: `NODE_ENV=production` ise hata verip
çıkar. Bilinçli olarak gerekiyorsa `--force` gerekir ve o durumda şifreler
`SEED_ADMIN_PASSWORD` / `SEED_STAFF_PASSWORD` ortam değişkenlerinden gelmek zorundadır
(en az 12 karakter) — demo şifreleri kullanılamaz.

**Yine de:** Bu sürümden önce production'a seed çalıştırdıysan üç şifreyi de derhal değiştir.

### `/docs` endpoint'i açık

Swagger UI `/docs` altında koşulsuz yayınlanır ve tüm endpoint listesini gösterir. Sistem
iç ağda olduğu için kabul edilebilir görülmüştür; internete açık bir kurulumda proxy
seviyesinde kapatmayı değerlendir.

---

## Doğru yapılan şeyler

Bunlar bilinçli tercihlerdir, bozma:

- **Fail-closed config:** `backend/src/config/index.ts` eksik/geçersiz env'de fallback'e
  düşmez, `process.exit(1)` yapar. Kodda hiçbir yerde hardcoded secret veya
  `process.env.X || 'default'` deseni yoktur.
- **Fail-closed şirket kapsamı:** `admin` dışındaki roller yalnızca `StaffCompany` ile
  atandıkları şirketleri görür; atama yoksa **hiçbir şey**. Kapsam mantığı
  `utils/staff-scope.ts`'te tek merkezdedir ve istemciden gelen `companyId` filtresi
  daima `resolveCompanyFilter` ile **kesiştirilir** — asla üzerine yazılmaz. Bu deseni
  bozma: `where.companyId = query.companyId` tek parametrelik bir yetki aşımıdır.
- **Şirket ataması yalnızca `admin`:** `PUT /staff/:id/companies` bir yetki kararıdır.
  `it_manager`'a açılırsa kendine tüm şirketleri atayıp kapsamı anlamsız kılabilir
  (kapsam her istekte DB'den okunur, token yenilemeye gerek yoktur).
- **Global kayıt politikası:** `companyId = null` olan kayıtlar (`CredentialEntry`,
  `Category`, `CustomField`) yalnızca `admin`'e açıktır. Bu `isCompanyInScope` içinde
  **açıkça** uygulanır — Postgres'in `IN (...)` semantiği NULL'ları zaten dışlar ama bu
  tesadüfi bir korumadır, ona güvenme.
- **CSP:** SPA'yı frontend nginx servis eder ve `script-src 'self'` uygular —
  `unsafe-inline`/`eval` **yok** (Vite build'i inline script üretmez). `/uploads`
  `default-src 'none'; sandbox` ile servis edilir: yüklenen dosya origin içinde kod
  çalıştıramaz.
- **Refresh token gerçekten iptal edilir:** Redis'te `refresh:<staffId>` altında tutulur ve
  yenilemede karşılaştırılır — çıkış yapmak oturumu sunucu tarafında sonlandırır.
- **Access token belleğe alınır:** Frontend Zustand store'u `partialize` ile yalnızca `user`
  nesnesini kalıcılaştırır; access token `localStorage`'a **yazılmaz**.
- **Şifre kasası:** AES-256-GCM (authenticated encryption), anahtar yalnızca ortam
  değişkeninde, liste endpoint'i şifreleri hiç döndürmez, her `reveal` audit log'lanır.
- **Rate limiting:** global 100/dk, staff login 5/dk, public lookup 10/5dk.
- **Dosya yükleme:** MIME allowlist + dosya adı sanitizasyonu + boyut sınırı.
- **`trustProxy`:** Reverse proxy arkasında gerçek client IP'yi kullanır — rate-limit ve
  audit log doğru IP'yi görür.
- **İç notlar sızmaz:** `TicketNote.isInternal` public endpoint'lerde filtrelenir.

---

## Kurmadan önce kontrol listesi

- [ ] Tüm `changeme_*` değerleri rastgele üretilmiş değerlerle değiştirildi
- [ ] `JWT_SECRET` ve `JWT_REFRESH_SECRET` birbirinden farklı ve ≥32 karakter
- [ ] `CREDENTIALS_ENC_KEY` `openssl rand -hex 32` ile üretildi ve **güvenli bir yerde
      yedeklendi** (veritabanı yedeğinden ayrı bir yerde)
- [ ] `NODE_ENV=production`
- [ ] Seed production'a karşı **çalıştırılmadı** (veya şifreler değiştirildi)
- [ ] `APP_URL` yalnızca gerçek FQDN'lerini içeriyor (CORS whitelist'i bu listedir)
- [ ] Sistem VPN/iç ağ arkasında veya proxy seviyesinde erişim kontrolü var
- [ ] Postgres/Redis host'a expose **edilmiyor** (`docker-compose.local.yml` production'da kullanılmıyor)
- [ ] Her `it_manager` ve `it_staff` hesabına en az bir şirket atandı — **atama yoksa
      kullanıcı hiçbir şey göremez** (fail-closed)
- [ ] Eski kurulumdan güncelliyorsan `npm run db:encrypt-smtp` çalıştırıldı
- [ ] Veritabanı yedeği alınıyor ve yedekler şifreleniyor
