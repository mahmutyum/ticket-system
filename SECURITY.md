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

### Public erişim token'ı log'lanıyor

Ticket takip linkindeki `accessToken` (`nanoid(32)`, ~192 bit) tahmin edilemez ama URL
YOLUNDA taşındığı için nginx `access_log`'una tam olarak yazılır (`$request`) ve
e-postalarda/tarayıcı geçmişinde kalır.

**Sınırlayıcı faktör:** Token artık ticket kapandıktan 90 gün sonra geçersizleşir;
süresi dolan link için `/public/track` (ticket no + e-posta) ile yeniden erişim alınır.
Yine de o pencerede log'a erişen biri ticket'ı görebilir.

**Geçici önlem:** Proxy log'larına erişimi kısıtla, saklama süresini kısa tut.

### SSE token'ı query parametresinde

Tarayıcının `EventSource` API'si özel header gönderemediği için, staff canlı bildirim
akışı kimliği query parametresinden alır.

**Sınırlayıcı faktör:** URL'de artık 15 dakikalık JWT değil, **30 saniye ömürlü tek
kullanımlık bilet** var — okunduğu anda silinir. Log'a düşen değer kullanıldığı anda ölü.
Kalan risk: kullanılmamış bir bilet 30 saniyelik pencerede yeniden kullanılabilir.

**Tam çözüm:** SSE yerine WebSocket (header gönderebilir).

**Geçici önlem:** Proxy log'larına erişimi kısıtla, log rotasyonunu sıkı tut.

### Seed demo şifreleri

`backend/prisma/seed.ts` geliştirme ortamında `admin@company.com` / `admin123` hesabını
`admin` rolüyle oluşturur (ayrıca `staff123` ile iki hesap daha).

Seed artık production'a karşı çalışmayı **reddeder**: `NODE_ENV=production` ise hata verip
çıkar. Bilinçli olarak gerekiyorsa `--force` gerekir ve o durumda şifreler
`SEED_ADMIN_PASSWORD` / `SEED_STAFF_PASSWORD` ortam değişkenlerinden gelmek zorundadır
(en az 12 karakter) — demo şifreleri kullanılamaz.

**Yine de:** Bu sürümden önce production'a seed çalıştırdıysan üç şifreyi de derhal değiştir.

### `/docs` varsayılan olarak açık

Swagger UI tüm endpoint listesini gösterir. İç ağ varsayımıyla varsayılan `true`;
internete açık bir kurulumda `ENABLE_API_DOCS=false` yap.

---

## Dosya yükleme — shell / web shell yükleme

Dosya yükleme klasik bir RCE yüzeyidir: saldırgan `shell.php` yükler, sonra
`https://host/uploads/shell.php` ister ve sunucuda komut çalıştırır. Bu sistemde
zincirin her halkası ayrı ayrı kırılmıştır — **tek bir savunmaya güvenilmez**:

**1. Uzantı istemciden ALINMAZ.** Diske yazılan uzantı yalnızca doğrulanmış MIME
tipinden türetilir (`ALLOWED_MIME_EXTENSIONS`, `storage.service.ts`). `shell.php`
gönderip `Content-Type: application/pdf` demek dosyayı `.pdf` yapar. Allowlist'te
`.php`, `.jsp`, `.asp`, `.sh`, `.cgi`, `.html` **yok**.

**2. Çift uzantı kurulamaz.** Dosya adının gövdesindeki her nokta `_` ile değiştirilir
(`[^a-zA-Z0-9_-]` → `_`), yani `shell.pdf.php` → `<nanoid>_shell_pdf.pdf`.
`.php.jpg` / `.jpg.php` numaraları çalışmaz.

**3. Yol enjeksiyonu yok.** Ad `basename()`'den geçer ve `nanoid(12)` ön eki alır;
`../../etc/cron.d/x` yazılamaz.

**4. Çalıştıracak yorumlayıcı yok.** Backend Node.js'tir. Konteynerlerde PHP,
PHP-FPM, CGI veya FastCGI **yoktur**; nginx conf'larında `fastcgi_pass` geçmez.
Bir `.php` dosyası diske yazılabilseydi bile düz metin olarak servis edilirdi.

**5. Dosyalar diskten servis EDİLMİYOR.** Ekler `/attachments/:id` route'undan
geçer: token veya şirket kapsamı doğrulanır, ardından `Content-Disposition:
attachment`, `default-src 'none'; sandbox` CSP'si ve `nosniff` ile döner. Yani
dosya çalıştırılmaz, tarayıcıda render edilmez, indirilir.

**6. `SVG` logo olarak reddedilir.** SVG aktif içeriktir (`<script>` taşır) ve
logolar `<img>` ile inline gömülür — bu yüzden `ALLOWED_LOGO_EXTENSIONS` dışında
tutulmuştur.

### Bu başlıkta düzeltilen gerçek açıklar

- **Uzantı doğrulanmıyordu.** `Content-Type: text/plain` (allowlist'te) +
  `filename="rapor.html"` → dosya `.html` yazılıyor → aynı origin'den `text/html`
  servis ediliyordu = **depolanmış XSS**. Allowlist atılan bir değeri denetliyordu;
  belirleyici olan uzantı serbestti.
- **nginx `alias` yetkilendirmeyi baypas ediyordu.** `proxy` profilinde
  `location /uploads/ { alias /app/uploads/; }` dosyaları doğrudan diskten
  okuyordu — backend'e hiç sormadan. Ek yetkilendirmesi o profilde tamamen devre
  dışıydı. Artık `/attachments`'a proxy'leniyor ve nginx'e uploads volume'u hiç
  bağlanmıyor.

  Gerçek nginx konteynerleriyle, aynı istek iki konfigürasyona karşı doğrulandı
  (uploads volume'u bilerek bağlı bırakılarak):

  | `GET /uploads/tkt1/gizli.pdf` | Sonuç |
  |---|---|
  | Eski konfigürasyon | `200` — **dosyanın içeriği** (kimlik doğrulaması yok) |
  | Yeni konfigürasyon | `200` — SPA HTML; dosya sızmıyor |
- **nginx `add_header` miras alınmıyordu.** `/uploads` location'ı kendi
  `add_header`'ını tanımladığı için server seviyesindeki CSP uygulanmıyordu —
  yüklenen dosyalar CSP'siz servis ediliyordu. (Gerçek nginx konteynerleriyle
  doğrulandı.)

### Kalan sınır

Ticket başına **20 dosya / 200 MB** kotası var, ama saklama süresi politikası yok:
kapanmış ticket'ların ekleri süresizce durur. Bkz. `docs/yol-haritasi.md` 1.5.

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
- **SSE şirket kapsamlı:** `broadcastToStaff` her yayında `companyId` ister
  (derleyici zorlar) ve alıcının kapsamıyla kesiştirir. Kapsam bağlantı anında
  çözülür, keep-alive turunda tazelenir. Bu olmadan REST katmanındaki tüm kapsam
  denetimi bu kanalda baypas edilir — deseni bozma.
- **E-posta şablonları bağlama göre kaçışlanır:** `renderHtmlTemplate` HTML
  gövdeler için değerleri kaçışlar; `renderTextTemplate` ham bırakır;
  `renderSubjectTemplate` CR/LF temizler. Şablon değerlerinin çoğu kimliksiz
  kullanıcıdan gelir — `bodyHtml`'e ham enjeksiyon, şirketin kendi SMTP'sinden
  DKIM imzalı phishing demektir.
- **Yükleme uzantısı doğrulanmış MIME'dan türer:** servis edilen `Content-Type`
  uzantıdan geldiği için asıl denetim oradadır. Allowlist istemcinin gönderdiği
  başlığa bakar ve tek başına YETERSİZDİR.
- **Hata handler'ı route kayıtlarından ÖNCE kurulur:** sonra kurulursa hiçbir
  route'a uygulanmaz (Fastify child context'i kayıt anında yakalar) ve ham hata
  detayları istemciye döner.
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
- **Opsiyonel TOTP MFA:** Personel hesapları authenticator tabanlı ikinci aşamayı
  etkinleştirebilir. TOTP sırrı AES-256-GCM ile şifrelenir; login challenge Redis'te
  5 dakika, kurulum sırrı 10 dakika tutulur.
- **Dosya yükleme:** MIME allowlist + dosya adı sanitizasyonu + boyut sınırı +
  uzantının doğrulanmış MIME'dan türetilmesi. SVG logo allowlist'te DEĞİLDİR
  (aktif içerik formatı).
- **`trustProxy` SINIRLI:** `TRUST_PROXY` kadar hop'a güvenilir, `true` DEĞİL. `true`
  olsaydı `request.ip` istemcinin gönderdiği `X-Forwarded-For`'un en solunu alırdı ve
  saldırgan her istekte taze bir rate-limit kovası açarak login brute force'unu
  sınırsız hale getirirdi. Audit log ayrıca `x-real-ip` kullanır — onu nginx
  `$remote_addr`'den set eder, sahtelenemez.
- **İç notlar sızmaz — İKİ katmanda:** `TicketNote.isInternal` public sorguda
  filtrelenir VE iç notların metni `ticket_history`'ye hiç yazılmaz. Tek başına
  ilk katman yetmiyordu: history ilişkisi filtrelenmediği için not metni
  `newValue` üzerinden public'e sızıyordu.
- **CSV formül nötrleştirme:** `=`/`+`/`-`/`@` ile (baştaki boşluk atlanarak)
  başlayan değerlere `'` öneki eklenir. Tırnaklamak YETMEZ — Excel tırnağı soyar
  ve formülü yine çalıştırır.

---

## Kurmadan önce kontrol listesi

- [ ] Tüm `changeme_*` değerleri rastgele üretilmiş değerlerle değiştirildi
- [ ] `JWT_SECRET` ve `JWT_REFRESH_SECRET` birbirinden farklı ve ≥32 karakter
- [ ] `CREDENTIALS_ENC_KEY` `openssl rand -hex 32` ile üretildi ve **güvenli bir yerde
      yedeklendi** (veritabanı yedeğinden ayrı bir yerde)
- [ ] `NODE_ENV=production`
- [ ] Seed production'a karşı **çalıştırılmadı** (veya şifreler değiştirildi)
- [ ] `APP_URL` yalnızca gerçek FQDN'lerini içeriyor (CORS whitelist'i bu listedir)
- [ ] **`TRUST_PROXY` topolojiye göre ayarlandı** — fazla verirsen istemcinin
      uydurduğu `X-Forwarded-For`'a güvenilir ve TÜM rate limit'ler (login dahil)
      geçersiz kalır. NPM/Coolify + frontend nginx → `2`. Doğrula: sahte
      `X-Forwarded-For: 1.2.3.4` gönder, audit log'da görünüyorsa değer fazladır.
- [ ] Sistem VPN/iç ağ arkasında veya proxy seviyesinde erişim kontrolü var
- [ ] Postgres/Redis host'a expose **edilmiyor** (`docker-compose.local.yml` production'da kullanılmıyor)
- [ ] Her `it_manager` ve `it_staff` hesabına en az bir şirket atandı — **atama yoksa
      kullanıcı hiçbir şey göremez** (fail-closed)
- [ ] Eski kurulumdan güncelliyorsan `npm run db:encrypt-smtp` çalıştırıldı
- [ ] Veritabanı yedeği alınıyor ve yedekler şifreleniyor
