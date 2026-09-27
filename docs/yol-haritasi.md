# Yol Haritası

Projenin güncel olgunluğu ve planlanan işler. Durum: 2026-09-27.

## Olgunluk özeti

| Alan | Durum |
|---|---|
| Özellik kapsamı | 🟢 Ticket yaşam döngüsü, SLA, raporlar, görevler, kasa, MFA |
| Çok dillilik | 🟢 TR/EN (arayüz + API mesajları + e-posta/SMS şablonları) |
| Kurulum / deploy | 🟢 Docker Compose, Coolify ve Nginx belgeli |
| Migration | 🟢 Versiyonlu; gerçek PostgreSQL üzerinde doğrulanabilir |
| Backend testleri | 🟢 235 birim/route/worker testi |
| Frontend testleri | 🟢 26 birim testi + 6 Playwright smoke/axe senaryosu |
| Entegrasyon | 🟢 Gerçek PostgreSQL + Redis testi |
| API dokümantasyonu | 🟢 Kritik route'larda request/response sözleşmeleri (OpenAPI) |
| Kod kalitesi | 🟢 Backend + frontend lint temiz, tipli |
| SLA doğruluğu | 🟡 Bekleme durumlarında ve mesai dışında süre işliyor (v1.1) |
| Yedekleme | 🟡 Elle çalıştırılan script; zamanlama ve uzak hedef yok (v1.2) |
| Yönetilebilirlik | 🟡 Durum, öncelik, şirket türü vb. kodda sabit enum; panelden eklenemiyor (v1.3) |

## Sürüm planı

| Sürüm | Tema |
|---|---|
| **v1.1** | SLA doğruluğu, talep yaşam döngüsü, kurumsal entegrasyon, ürün olgunluğu, gözlemlenebilirlik |
| **v1.2** | Otomatik yedekleme, merkezi zamanlanmış görev (cron) altyapısı, uzak yedek hedefleri |
| **v1.3** | DB'den yönetilen sözlükler (şirket türü, durum, öncelik…), "Taleplerim", S3 depolama, Docker Hub imajları, sürüm otomasyonu |

---

## v1.1

### 1. SLA doğruluğu

Bugünkü `sla-check.worker.ts` yalnızca `slaResponseDue` / `slaResolveDue` ile şimdiki
zamanı karşılaştırır. Bu, raporlardaki SLA oranlarını yanıltıcı hâle getirir.

**1.1 Bekleme durumlarında SLA duraklatma**
- `waiting_user_response`, `waiting_other_department`, `on_hold` (ve kararlaştırılırsa
  `process_outside_it`) durumlarında SLA saati durur; aktif duruma dönüşte kalan süre
  kadar ileri kaydırılır.
- Ticket'a `slaPausedAt` ve toplam `slaPausedMinutes` alanları; duraklatma/devam
  `TicketHistory`'e yazılır.
- Hangi durumların SLA'yı durdurduğu `config/constants.ts`'de tek listede tanımlanır.
- Raporlarda "duraklatılmış süre" ayrı gösterilir.

**1.2 Mesai saatleri ve tatil takvimi**
- Şirket bazlı çalışma takvimi: gün/saat aralıkları + saat dilimi.
- Şirket bazlı resmî tatil / özel kapalı gün listesi (yıllık kopyalama kolaylığı).
- SLA bitiş zamanı yalnızca mesai içindeki dakikalar sayılarak hesaplanır; takvim
  tanımlı değilse bugünkü 7/24 davranışı korunur (geriye uyumlu).
- Öncelik bazında "7/24 SLA" istisnası (ör. `critical`).

**1.3 İhlal öncesi uyarı ve eskalasyon**
- Eşik tabanlı uyarı (varsayılan %80, şirket bazlı ayarlanabilir); her eşik ticket
  başına bir kez gönderilir.
- Atanmamış ticket'larda uyarı, şirket kapsamındaki `it_manager`'lara gider.
- İhlal sonrası eskalasyon: yöneticiye bildirim + opsiyonel öncelik yükseltme.
- Staff SSE kanalına SLA uyarı olayı (panelde anlık rozet).

**1.4 SLA bildirimlerinde i18n düzeltmesi**
- `slaType` değeri worker'da Türkçe sabit metin (`'Yanıt Süresi'`, `'Çözüm Süresi'`)
  olarak geçiliyor; `backend/src/i18n/labels.ts` üzerinden alıcının diline göre
  üretilmeli. Aynı tarama diğer worker değişkenleri için de yapılır.

### 2. Talep yaşam döngüsü

**2.1 Otomatik kapatma**
- `resolved` durumundaki ticket N gün (varsayılan 7) içinde yeniden açılmazsa `closed`.
- `waiting_user_response` durumunda N gün yanıt gelmezse önce hatırlatma, sonra kapatma.
- Süreler şirket bazlı; kapatma `TicketHistory`'e sistem aktörüyle yazılır ve
  talep sahibine çift dilli bildirim gider.

**2.2 E-posta ile yanıt (inbound)**
- Şirket bazlı IMAP (veya Microsoft 365 / Gmail OAuth) posta kutusu; BullMQ ile periyodik
  çekme.
- Gelen yanıt, konu/`In-Reply-To` başlığındaki ticket numarası + gönderen e-posta
  eşleşmesiyle public not olarak eklenir; alıntılanan önceki mesaj kırpılır.
- Ekler mevcut MIME allowlist + magic-byte doğrulamasından geçer.
- Eşleşmeyen e-postadan yeni ticket oluşturma (şirket bazlı opsiyonel).
- Döngü koruması: otomatik yanıtlar (`Auto-Submitted`, `X-Autoreply`) yok sayılır;
  gönderen başına rate limit.
- Posta kutusu kimlik bilgileri AES-256-GCM ile şifreli saklanır.

**2.3 Birleştirme, üst/alt ilişki ve izleyiciler**
- Ticket birleştirme: notlar/ekler hedef ticket'a taşınır, kaynak `closed` + yönlendirme.
- Üst/alt (parent/child) ilişki: yaygın arızada tek ana ticket, alt ticket'lar ana
  ticket çözülünce toplu kapatılabilir.
- CC / izleyici: talep sahibi dışında e-posta adresleri ve personel izleyiciler
  bildirim alır. Şirket kapsamı denetimi korunur.

### 3. Kurumsal entegrasyon

**3.1 Personel için SSO / dizin entegrasyonu**
- OIDC (Entra ID, Keycloak, Google Workspace) öncelikli; SAML 2.0 ikinci adım.
- LDAP/Active Directory ile bind tabanlı giriş ve grup → rol / şirket eşlemesi.
- İlk girişte personel kaydı oluşturma (JIT provisioning) opsiyonel; rol ve şirket
  ataması yine yalnızca admin onayıyla veya açık grup eşlemesiyle yapılır.
- Yerel parola girişi admin tarafından kapatılabilir (break-glass admin hesabı hariç).
- SSO ile giren hesaplarda MFA, IdP'ye devredilir.

**3.2 Webhook ve sohbet bildirimleri**
- Olay tabanlı giden webhook (ticket oluşturuldu/güncellendi/SLA ihlali); HMAC imzalı
  gövde, BullMQ ile retry.
- Microsoft Teams ve Slack kanal bildirimleri (incoming webhook).
- Hedef URL'ler için mevcut SSRF korumaları uygulanır; iç notlar dış kanallara gitmez.

### 4. Ürün olgunluğu

**4.1 Memnuniyet anketi (CSAT)**
- Kapanışta talep sahibine tek tıklık 1–5 puan + opsiyonel yorum (mevcut access token
  bağlantısı üzerinden, ayrı hesap yok).
- Raporlarda şirket / kategori / personel bazında CSAT ortalaması.

**4.2 Bilgi bankası**
- Şirket bazlı ve global makaleler (Markdown, çift dil), kategori ilişkisi.
- Public portalda arama; ticket sihirbazında seçilen kategoriye göre ilgili makale önerisi
  ("Bu çözdü mü?" ile talep açmadan çıkış metriği).
- Personel tarafında makaleyi hazır yanıt olarak ticket'a ekleme.

**4.3 Varlık (envanter) bağlantısı**
- Hafif varlık kaydı: tür, etiket/seri no, konum, zimmetli kişi e-postası.
- Ticket'a varlık bağlama; varlık bazında ticket geçmişi.
- Tam CMDB hedeflenmez; CSV içe aktarma yeterli başlangıçtır.

### 5. Gözlemlenebilirlik

- Prometheus uyumlu `/metrics` (yalnızca dahili ağ): HTTP gecikme/hata, BullMQ kuyruk
  derinliği ve başarısız iş sayısı, gönderilemeyen bildirimler, açık SLA ihlalleri,
  SSE bağlantı sayısı.
- `operasyon.md`'deki alarm başlangıçları için örnek alert kuralları.

---

## v1.2 — Otomatik yedekleme ve zamanlanmış görevler

Bugün yedekleme `scripts/backup.sh` ile **elle** alınır ve yalnızca yerel diske yazılır
(`database.dump` + `uploads.tar.gz` + `environment.snapshot` + `SHA256SUMS`). Zamanlama
host cron'una, uzak kopya operatöre bırakılmıştır. v1.2 bunu sistemin kendi yönettiği,
izlenebilir bir sürece dönüştürür.

### 1. Merkezi zamanlanmış görev (cron) altyapısı

Periyodik işler bugün dağınık: SLA kontrolü koda gömülü 5 dakikalık BullMQ işi,
retention kontrolü host cron'u. Hedef, tüm periyodik işleri tek yerden yönetmek.

- BullMQ repeatable job'ları üzerine **görev kayıt defteri**: her görevin anahtarı,
  cron ifadesi, saat dilimi, aktif/pasif durumu ve varsayılanı kodda tanımlanır;
  yönetici paneli yalnızca izin verilen alanları değiştirir.
- Kapsanan görevler: SLA kontrolü, otomatik kapatma (v1.1), inbound e-posta çekme (v1.1),
  retention **check**, yedekleme, yedek doğrulama / restore provası.
- `scheduled_job_runs` tablosu: başlangıç/bitiş, süre, sonuç, özet çıktı, hata.
- **Tekil çalışma kilidi** (Redis): aynı görev üst üste binmez; çoklu backend
  replikasında yalnızca biri çalıştırır.
- Admin paneli "Zamanlanmış Görevler" sayfası: son/sonraki çalışma, geçmiş, elle tetikleme,
  duraklatma. Cron ifadesi kaydedilmeden önce doğrulanır ve sonraki 5 çalışma zamanı
  önizlenir.
- Başarısız çalışmada yöneticilere bildirim (e-posta + v1.1 webhook/Teams/Slack).
- Retention **apply** bilinçli olarak otomatik zamanlanamaz; insan onayı ilkesi korunur.

### 2. Otomatik yedekleme

- Yedekleme, `pg_dump` + `tar` + aktarım araçlarını içeren ayrı bir **`backup` servisi**
  (compose'da opsiyonel profil) tarafından yürütülür; backend imajı şişirilmez.
  Tetikleme backend'deki zamanlayıcıdan kuyruk aracılığıyla gelir, sonuç
  `scheduled_job_runs`'a yazılır.
- İçerik bugünkü script ile aynı formattadır (restore uyumluluğu korunur):
  PostgreSQL özel format dump, uploads arşivi, ortam anlık görüntüsü, `SHA256SUMS`.
  S3-uyumlu depolama sürücüsü (v1.3) etkinse uploads arşivi yerine
  bucket versioning/replikasyonu kullanılabilir.
- Yedek türleri: tam yedek (varsayılan günlük); uploads için opsiyonel artımlı arşiv.
- **Şifreleme zorunlu (uzak hedeflerde):** arşiv, yüklenmeden önce `age` açık anahtarı
  (veya parola tabanlı AES-256) ile şifrelenir. `environment.snapshot` sır içerdiği
  için şifresiz uzak kopya reddedilir. Şifre çözme anahtarı sistemde tutulmaz.
- Sıkıştırma ve boyut raporu; boş/şüpheli küçük dump'ta çalışma başarısız sayılır.
- Yedekten önce disk alanı kontrolü.

### 3. Uzak yedek hedefleri

Aktarım katmanı **rclone** tabanlıdır; tek bir arayüzle çok sayıda hedef desteklenir.
Birden fazla hedef aynı anda tanımlanabilir (ör. yerel + S3 + Google Drive).

| Hedef | Kimlik doğrulama | Not |
|---|---|---|
| Yerel disk / bağlı volume | — | Varsayılan; NAS mount'ları dahil |
| S3-uyumlu (AWS S3, MinIO, Cloudflare R2, Backblaze B2, Wasabi) | Access key / secret, endpoint, bölge | Object Lock / versioning önerilir |
| Google Drive | OAuth (servis hesabı veya kullanıcı yetkilendirme) | Paylaşılan Drive klasörü desteklenir |
| FTP / FTPS | Kullanıcı / parola | Yalnızca FTPS önerilir; düz FTP uyarıyla |
| SFTP | Parola veya SSH anahtarı | Host key doğrulaması zorunlu |
| WebDAV (Nextcloud vb.) | Kullanıcı / uygulama parolası | |
| SMB / Windows paylaşımı | Kullanıcı / parola / domain | Kurum içi dosya sunucuları için |
| Azure Blob, OneDrive / SharePoint | Bağlantı dizesi / OAuth | İkinci aşama |

- Hedef tanımları admin panelinden yönetilir; kimlik bilgileri credential vault ile aynı
  şekilde AES-256-GCM şifreli saklanır, arayüzde maskeli gösterilir, değişiklikler
  audit log'a yazılır.
- "Bağlantıyı test et": küçük bir deneme dosyası yazıp okuyup siler.
- Yükleme sonrası uzak dosyanın boyut/sağlama toplamı doğrulanır.
- Bir hedefin başarısız olması diğerlerini durdurmaz; sonuç hedef bazında raporlanır.
- Hedef URL'leri için SSRF korumaları (iç ağ adresleri yalnızca açıkça izin verilirse).

### 4. Saklama politikası (retention)

- Hedef bazında GFS rotasyonu: son N günlük, N haftalık, N aylık yedek
  (varsayılan 7 / 4 / 6).
- Eski yedekler yalnızca yeni yedek **başarıyla doğrulandıktan sonra** silinir.
- Son başarılı yedek hiçbir koşulda silinmez.

### 5. Doğrulama ve geri yükleme

- Periyodik **restore provası**: son yedek geçici bir PostgreSQL konteynerine açılır,
  tablo/satır sayıları ve migration sürümü kontrol edilir, sonra ortam silinir.
- Admin panelinde yedek listesi (tüm hedeflerden), boyut, süre, doğrulama durumu.
- Uzak hedeften indirme + mevcut `restore.sh` akışıyla geri yükleme; restore web
  arayüzünden tetiklenmez (yıkıcı işlem, operatör onayıyla CLI'dan).
- `operasyon.md` "26 saatten eski backup" alarmı `/metrics` üzerinden
  (`backup_last_success_timestamp`) otomatik izlenir.

### 6. Konfigürasyon (taslak)

```env
BACKUP_ENABLED=true
BACKUP_CRON=0 3 * * *
BACKUP_TZ=Europe/Istanbul
BACKUP_ENCRYPTION_RECIPIENT=age1...        # uzak hedefler için zorunlu
BACKUP_RETENTION_DAILY=7
BACKUP_RETENTION_WEEKLY=4
BACKUP_RETENTION_MONTHLY=6
BACKUP_VERIFY_CRON=0 5 * * 0               # haftalık restore provası
```

Env değerleri varsayılandır; panelden yapılan değişiklik veritabanında saklanır ve
önceliklidir. Hedef kimlik bilgileri env'e yazılmaz.

---

## v1.3 — Yönetilebilir yapı ve dağıtım

### 1. DB'den yönetilen sözlükler (referans verileri)

Bugün şirket türü, ticket durumu, öncelik, görev durumu ve yerinde destek türü/durumu
**Prisma enum'u** olarak kodda sabit. Yeni bir değer eklemek migration + deploy + çeviri
dosyası güncellemesi gerektiriyor; etiket ve renkler backend `config/constants.ts`,
frontend `types/index.ts` ve `i18n/locales/*.json` arasında dağınık. Hedef: bu listelerin
admin panelinden **eklenip düzenlenebildiği** veritabanı tabloları olması.

**Kapsam**

| Sözlük | Bugün | v1.3 | Değere bağlı sistem davranışı |
|---|---|---|---|
| Şirket türü | `CompanyGroupType` enum | `company_types` tablosu | — (etiket, renk, sıra) |
| Ticket durumu | `TicketStatus` enum | `ticket_statuses` tablosu | **Durum sınıfı** (aşağıda) |
| Öncelik | `Priority` enum | `priorities` tablosu | Sıralama ağırlığı, varsayılan SLA dakikaları, 7/24 SLA bayrağı (v1.1) |
| Görev durumu | `TaskStatus` enum | `task_statuses` tablosu | Durum sınıfı: açık / aktif / tamamlandı / iptal |
| Yerinde destek türü | `OnsiteType` enum | `onsite_types` tablosu | Varsayılan süre, konum/oda gerekli mi |
| Yerinde destek durumu | `OnsiteStatus` enum | `onsite_statuses` tablosu | Durum sınıfı: planlı / aktif / tamamlandı / iptal |

**Bilinçli olarak kodda kalanlar**
- `StaffRole`: RBAC ve şirket kapsamı güvenlik kararlarına bağlı; panelden rol tanımlamak
  ayrı bir yetki modeli tasarımı gerektirir, bu sürümün kapsamı dışında.
- `CustomFieldType`: her tipin doğrulama ve render davranışı kodda.
- `NotificationType` / `NotificationStatus`: kuyruk ve worker iç durumu.

**Ortak sözlük modeli**
- Her kayıtta: değişmez `key` (slug), çift dil etiket (`labelTr`, `labelEn` veya çeviri
  tablosu — i18n kararıyla), renk, opsiyonel ikon, sıra, `isActive`, `isSystem`.
- `isSystem` kayıtlar (mevcut enum değerlerinin karşılıkları) silinemez, yalnızca etiket /
  renk / sıra düzenlenir ve gerekirse pasifleştirilir.
- Kullanımdaki bir kayıt silinmez; **pasifleştirilir** (yeni kayıtlarda seçilemez, eski
  kayıtlarda görünmeye devam eder) veya "başka bir değerle birleştir" ile taşınır.
- Opsiyonel şirket kapsamı: kayıt global veya belirli şirketlerde aktif. Global kayıt
  yönetimi yalnızca admin (mevcut "global kayıtlar yalnızca admin" kuralı).
- Tüm değişiklikler audit log'a yazılır.

**Durum sınıfı — davranış anahtara değil sınıfa bağlanır**

Kod bugün durumlara isimleriyle bakıyor (ör. SLA kontrolünde
`status: { notIn: ['resolved', 'closed'] }`; backend + frontend'de ~17 dosyada ~50 sabit
literal). Serbestçe eklenen bir durumun sistemi bozmaması için her durum sabit bir
**sınıfa** eşlenir ve kod yalnızca sınıfa bakar:

| Sınıf | Anlamı | Mevcut karşılıklar |
|---|---|---|
| `new` | Yeni, henüz ele alınmadı | `open` |
| `active` | Üzerinde çalışılıyor; SLA işler | `in_progress`, `topic_transferred` |
| `waiting` | Dış tarafa bağlı; **SLA durur** (v1.1) | `waiting_user_response`, `waiting_other_department`, `on_hold`, `process_outside_it` |
| `resolved` | Çözüldü; otomatik kapatma sayacı başlar (v1.1) | `resolved` |
| `closed` | Kapalı; public erişim süresi sayacı başlar | `closed` |

- v1.1'de `constants.ts`'e yazılacak "SLA'yı durduran durumlar" listesi bu sınıfa taşınır.
- Opsiyonel: izin verilen durum geçişleri (iş akışı) tanımı; tanımsızsa tüm geçişler serbest.
- Her sınıfta en az bir aktif durum bulunması zorunludur; varsayılan "yeni ticket" durumu
  seçilebilir.

**Geçiş (migration) planı**
1. Sözlük tablolarını oluştur, mevcut enum değerlerini **aynı key'lerle** `isSystem` olarak
   seed et (TR/EN etiketleri mevcut çeviri dosyalarından).
2. İlgili kolonları enum'dan sözlük tablosuna FK'ya çevir (veri dönüşümü key üzerinden,
   kayıpsız); `TicketHistory` eski/yeni değerleri key olarak saklamaya devam eder.
3. Koddaki sabit literal kontrolleri sınıf tabanlı sorgulara çevir; tarama için lint kuralı
   (sözlük key'lerinin string literal olarak kullanılmasını yasakla).
4. Zod doğrulaması `z.nativeEnum` yerine DB'den okunan, Redis'te önbelleklenen aktif key
   kümesine karşı yapılır; sözlük değişince önbellek geçersizlenir.
5. Frontend: tek `GET /lookups` uç noktası (TanStack Query, uzun `staleTime`);
   `types/index.ts` içindeki `STATUS_LABELS` / `STATUS_COLORS` / `PRIORITY_WEIGHT` vb. ve
   `i18n/locales/*.json` içindeki `enums.*` sözlükleri kaldırılır, `useEnumLabels`
   DB verisini okur.
6. Bildirim şablonları, raporlar ve CSV export etiketleri alıcının / isteğin diline göre
   DB'den alır (`backend/src/i18n/labels.ts`).
7. Admin paneli: "Sözlükler" sayfası — liste, sürükle-bırak sıralama, renk seçici, çift dil
   etiket, pasifleştir / birleştir.

**Kabul ölçütü:** yeni bir şirket türü, ticket durumu veya öncelik, kod değişikliği ve
deploy olmadan panelden eklenip TR/EN arayüzde, bildirimlerde ve raporlarda doğru
görünür; SLA ve otomatik kapatma davranışı durum sınıfına göre doğru çalışır.

### 2. "Taleplerim" — talep sahibi için birleşik takip

Bugün bir talebe erişim, o talebe özel bağlantı (veya ticket numarası + e-posta) ile
sağlanıyor; birden fazla talep açan kullanıcının hepsini tek yerde görmesi için bir
akış yok.

**Plan:** Kullanıcı e-postasını girer; gelen kutusuna gönderilen **kısa ömürlü doğrulama
bağlantısıyla** o e-postaya ait tüm taleplerini tek listede görür ve takip eder. Parola
yok — e-posta sahipliği doğrulanır. Mevcut altyapıyı (kısa ömürlü token, Redis, BullMQ
e-posta kuyruğu, rate limit) kullanır; yeni tablo gerektirmez. Yeni çift dilli
bildirim şablonu (`my_tickets_link`) ve bir public sayfa (`MyTicketsPage`) eklenir.

### 3. Docker Hub imajları ve tek-komut kurulum

Bugün `docker compose` imajları yerelde **derliyor**. Hedef: backend ve frontend
imajlarını CI ile **Docker Hub'a yayınlamak** ve sürüm etiketiyle (`:1.0.0`, `:latest`)
`docker pull` edilip derleme gerektirmeden çalıştırılabilen bir compose sağlamak — böylece
sistem, kaynağı klonlamadan indirilip kurulabilir.

- GitHub Actions ile `main`/tag push'unda çok mimarili (amd64/arm64) imaj build + push.
- Published imajları kullanan `docker-compose.hub.yml` (build yerine `image:`).
- Sürüm etiketleme: `:MAJOR.MINOR.PATCH`, `:MAJOR.MINOR`, `:latest`.
- v1.2 `backup` servisi imajı da aynı akışla yayınlanır.

### 4. Sürüm takibi ve otomatik changelog

- SemVer git tag'leri + GitHub Releases.
- Conventional commit'lerden **otomatik CHANGELOG** üretimi (elle bakım yerine).
- İmaj etiketleri sürümle senkron.

### 5. S3-uyumlu depolama (AWS S3 / MinIO)

Ekler ve logolar bugün yerel diske yazılır (`UPLOAD_DIR`). Hedef: yükleme katmanını
**S3-uyumlu object storage** (AWS S3, MinIO, R2) arkasına almak — yatay ölçek, yedeklilik
ve konteyner-dışı kalıcılık için.

- `storage.service.ts` arkasına takılabilir depolama adaptörü (yerel disk | S3).
- Env ile seçim (`STORAGE_DRIVER=local|s3`, `S3_ENDPOINT`, `S3_BUCKET`, anahtarlar).
- İndirme yetkilendirmesi backend'de kalır (imzalı/proxy'li erişim); doğrudan public bucket yok.
- v1.2 yedekleme ile ilişki: S3 sürücüsü aktifse uploads yedeği bucket versioning /
  replikasyonuna devredilebilir; veritabanı yedeği yine v1.2 akışıyla alınır.

---

## Sürekli operasyon

- Yedek almanın yanında geri yükleme tatbikatını da periyodik çalıştır (v1.2 ile otomatikleşir).
- Retention işini izle (`db:retention:check`) ve onaylı bakım penceresinde uygula.
- İnternete açık kurulumlarda erişim kontrolü ve `ENABLE_API_DOCS=false` zorunlu kabul et.

## Ürün tercihleri (bilinçli)

- Public portalda kalıcı kullanıcı hesabı / parola yoktur; erişim bağlantı tabanlıdır.
- Ayrı bir component kütüphanesi kullanılmaz; arayüz Tailwind ile proje içinde tutulur.
- Yerinde destek randevuları personele atanmaz; paralel randevu çakışma sayılmaz.
- Personel parolası en az 12 karakterdir.
- Yıkıcı işlemler (retention apply, restore) otomatik zamanlanmaz ve web arayüzünden
  tetiklenmez.

## Katkı standardı

Yeni route ve ekranlarda aynı tipli sözleşme, kapsam/RBAC ve regresyon testi standardını
koru. Güvenlik açığı bildirimi için [SECURITY.md](../SECURITY.md), katkı rehberi için
[CONTRIBUTING.md](../CONTRIBUTING.md).
