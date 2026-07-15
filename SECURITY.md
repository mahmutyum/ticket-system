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

### Şirket SMTP şifreleri düz metin saklanıyor

`CompanySmtp.pass` veritabanında **şifrelenmeden** tutulur. Şema dosyasındaki
`// encrypted in production` yorumu **doğru değildir** — kod bu şifrelemeyi hiçbir yerde
yapmaz. Okuma yolunda panelde maskelenir, ama veritabanına erişen herkes şifreleri düz
görür.

**Etkisi:** DB yedeğine veya `pgadmin`/`psql` erişimine sahip biri tüm şirket SMTP
kimlik bilgilerini okuyabilir.

**Geçici önlem:** Veritabanı erişimini kısıtla, yedekleri şifrele. Şirket bazlı SMTP yerine
global SMTP kullanmayı değerlendir.

Kalıcı çözüm için: `docs/yol-haritasi.md`.

### `it_staff` şirket kapsamı fail-open

`backend/src/utils/staff-scope.ts` — **hiçbir şirkete atanmamış** bir `it_staff`
kullanıcısı **tüm şirketlerin** ticket'larını görür. Bu, geriye dönük uyumluluk için
bilinçli bırakılmış bir varsayılandır, ama güvenli tarafa değil **açık tarafa** düşer:
yeni bir personel eklerken şirket ataması yapmayı unutursan, kısıtlı olmasını beklediğin
hesap sınırsız erişime sahip olur.

**Geçici önlem:** Her `it_staff` hesabına en az bir şirket ata.

### SSE token'ı query parametresinde

Tarayıcının `EventSource` API'si özel header gönderemediği için, staff canlı bildirim
akışı JWT'yi query parametresinde alır: `/events/staff?token=<JWT>`.

**Etkisi:** Token nginx `access_log`'una ve araya giren her proxy'nin log'una yazılır.

**Sınırlayıcı faktör:** Access token'lar 15 dakika ömürlüdür. Yine de log'lara erişimi olan
biri kısa süreli oturum ele geçirebilir.

**Geçici önlem:** Proxy log'larına erişimi kısıtla, log rotasyonunu ve saklama süresini sıkı tut.

### CSP kapalı

`backend/src/app.ts` — helmet kayıtlı ama `contentSecurityPolicy: false`. XSS'e karşı
derinlemesine savunma katmanı yok.

### Seed varsayılan şifreleri

`backend/prisma/seed.ts`, `admin@company.com` / `admin123` hesabını **`admin` rolüyle**
oluşturur (ayrıca `staff123` ile iki hesap daha) ve üçünü de stdout'a yazar. Seed
`NODE_ENV` kontrolü yapmaz — production veritabanına karşı çalıştırılmasını **hiçbir şey
engellemez**.

**Önlem:** `prisma/seed.ts`'i asla production'a karşı çalıştırma. Çalıştırdıysan üç şifreyi
de derhal değiştir.

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
- [ ] Her `it_staff` hesabına en az bir şirket atandı
- [ ] Veritabanı yedeği alınıyor ve yedekler şifreleniyor
