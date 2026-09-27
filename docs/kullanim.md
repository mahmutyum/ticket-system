# Kullanım Kılavuzu

Bu doküman sistemin **nasıl kullanıldığını** anlatır. Kurulum için
[kurulum.md](kurulum.md), teknik detay için [mimari.md](mimari.md).

- [Kimler ne yapabilir](#kimler-ne-yapabilir)
- [Talep eden — public portal](#talep-eden--public-portal)
- [IT ekibi — staff paneli](#it-ekibi--staff-paneli)
- [Yönetici işlemleri](#yönetici-işlemleri)
- [Şifre kasası](#şifre-kasası)
- [İlk kurulum sonrası yapılacaklar](#ilk-kurulum-sonrası-yapılacaklar)

---

## Kimler ne yapabilir

Sistemde iki tür kullanıcı var: **talep edenler** (şifresiz, kayıt yok) ve **staff**
(şifreli giriş, rollü).

| Sayfa | Talep eden | `it_staff` | `it_manager` | `admin` |
|---|:--:|:--:|:--:|:--:|
| Ticket oluştur / takip et (public) | ✅ | ✅ | ✅ | ✅ |
| Dashboard, ticket yönetimi, takvim, görevler | — | ✅ | ✅ | ✅ |
| Şirket / lokasyon / kategori / özel alan yönetimi | — | — | ✅ | ✅ |
| Raporlar, şablonlar | — | — | ✅ | ✅ |
| Şifre kasası | — | — | ✅ | ✅ |
| Personel yönetimi ve şirket atama | — | — | — | ✅ |

Roller: `admin` (Sistem Yöneticisi), `it_manager` (IT Yöneticisi), `it_staff` (IT Personeli).

### Şirket kapsamı — en önemli kavram

| Rol | Ne görür |
|---|---|
| `admin` | **Her şey.** Tüm şirketler, şirkete bağlı olmayan ("global") kayıtlar dahil. |
| `it_manager` | **Yalnızca atandığı şirketler.** Şirkete özel yöneticidir. |
| `it_staff` | **Yalnızca atandığı şirketler.** |

Personel `Personel Yönetimi` ekranından şirketlere atanır. Bu yalnızca **`admin`**
tarafından yapılabilir — şirket ataması bir yetki kararıdır.

> ⚠️ **Kapsam fail-closed'dır:** Hiçbir şirkete atanmamış bir `it_manager` veya `it_staff`
> **hiçbir şey göremez** — boş dashboard, boş ticket listesi. Bu bir hata değil, bilinçli
> tercihtir: atama yapmayı unutursan hesap sınırsız erişim kazanmaz.
>
> **Yeni personel eklerken şirket atamasını unutma.** Kullanıcı "hiçbir şey görmüyorum"
> diyorsa ilk bakılacak yer burasıdır.

`it_manager` kendi şirketleri içinde şunları yapar: ticket yönetimi, lokasyon/kategori/özel
alan tanımları, raporlar ve şifre kasası. Yetkili olmadığı bir şirketin verisine hiçbir
yoldan erişemez — kayıtları o şirkete taşıyamaz, kendine şirket atayamaz.

---

## Talep eden — public portal

Giriş yok, kayıt yok. Talep eden yalnızca e-posta adresini verir.

### Ticket oluşturma — `/create`

1. **Şirket** seç → o şirkete tanımlı **lokasyon** ve **kategori**ler yüklenir.
2. **Kategori** seç → kategoriye bağlı SLA süreleri ve otomatik atama devreye girer.
3. Şirkete özel **dinamik alanlar** doldurulur (metin, sayı, seçim, telefon, URL, e-posta,
   uzun metin tipleri desteklenir — yönetici tanımlar).
4. Başlık, açıklama, öncelik ve isteğe bağlı **dosya ekleri** (varsayılan üst sınır 25 MB).
5. Gönderildiğinde ticket bir **numara** ve tahmin edilemez bir **erişim linki** alır.

> Şirketin `allowedDomains` ayarı varsa, talep edenin e-posta domain'i bu listede olmalıdır.

### Bilgi bankası — `/kb`

Yayındaki çözüm makaleleri portalda aranabilir. Talep sihirbazında kategori seçildiğinde o
kategorinin makaleleri önerilir; kullanıcı "Evet, sorunum çözüldü" derse talep açılmadan
çıkılır (makalenin "önlenen talep" sayacı artar). Şirkete özel makaleler yalnızca o şirketin
portalından görünür.

**Yönetim — `/staff/kb`:** makaleler Markdown ile yazılır (ham HTML işlenmez), TR zorunlu,
EN isteğe bağlıdır (yoksa TR gösterilir). Global makaleleri yalnızca `admin`, şirkete özel
makaleleri kapsamındaki `it_manager` düzenler; tüm personel okuyabilir ve ticket notuna
"Bilgi bankasından ekle" ile makale bağlantısı ekleyebilir. Görüntülenme, 👍/👎 ve önlenen
talep sayıları listede görünür.

### Memnuniyet anketi (CSAT)

Talep çözülünce/kapanınca talep sahibine bir kez anket e-postası gider (şirketin **SLA &
Mesai** ekranından kapatılabilir). E-postadaki yıldızlar puanı takip sayfasında önceden
seçer; puan kullanıcı **Gönder**'e bastığında kaydedilir (e-posta güvenlik tarayıcılarının
bağlantıları otomatik açması sahte oy üretmesin). Puan 1–5, isteğe bağlı yorumla; talep
başına bir kez. Sonuçlar **Raporlar → Memnuniyet** sekmesinde: ortalama, yanıt oranı,
dağılım, personel/kategori/şirket kırılımı ve son yorumlar.

### Durum takibi — erişim linki

Oluşturma sonrası (ve bildirim e-postalarında) verilen link:
`https://<site>/ticket/<accessToken>`

Bu sayfada talep eden:
- Ticket'ın **canlı** durumunu görür (SSE ile anlık güncellenir).
- **Yanıt yazar** ve **ek dosya** gönderir.
- IT ekibinin public notlarını okur. **İç notlar burada görünmez.**

> ⚠️ Link'i olan **herkes** o ticket'ı görebilir — link'in kendisi paroladır. Talep edene
> özel link'i paylaşmamasını hatırlat.

### Geçmiş talepler — `/track`

Ticket numarası + e-posta ile sorgulama. Alternatif olarak sadece e-posta ile o adrese ait
tüm ticket'lar listelenir (dakikada 10 istek ile sınırlı).

### Ticket durumları

| Durum | Anlamı |
|---|---|
| `open` | Açık — henüz ele alınmadı |
| `in_progress` | İşlemde |
| `waiting_user_response` | Kullanıcı yanıtı bekleniyor |
| `waiting_other_department` | Diğer birimden destek bekleniyor |
| `topic_transferred` | Konu aktarıldı |
| `process_outside_it` | Süreç IT dışında ilerliyor |
| `on_hold` | Beklemede |
| `resolved` | Çözüldü |
| `closed` | Kapatıldı |

Öncelikler: `low` (Düşük), `medium` (Orta), `high` (Yüksek), `critical` (Kritik).

---

## IT ekibi — staff paneli

Giriş: `/staff/login`. Oturum 15 dakikalık access token + 7 günlük refresh cookie ile
yönetilir; sekmeyi kapatıp açtığında oturum korunur, "Çıkış" dediğinde sunucu tarafında
gerçekten iptal edilir.

Giriş yaptıktan sonra **Hesap ve Güvenlik** ekranından authenticator tabanlı iki aşamalı
doğrulama etkinleştirilebilir. Kurulum anahtarı 10 dakika geçerlidir; etkinleştirme için
uygulamanın ürettiği ilk 6 haneli kod doğrulanır. Sonraki girişlerde şifreden sonra bu kod
istenir.

### Dashboard — `/staff`

Açık/işlemdeki/çözülen ticket sayıları, SLA durumu (yaklaşan ve aşılmış), üzerine atanmış
ticket'lar.

### Ticket yönetimi — `/staff/tickets`

- **Liste:** duruma, önceliğe, şirkete, kategoriye, atanana göre filtre; serbest metin arama.
- **Toplu işlem:** birden fazla ticket seçip durum/atama değiştirme.
- **Detay** (`/staff/tickets/:id`):
  - Durum ve öncelik değiştirme, personele atama.
  - **Public yanıt** — talep eden görür, e-posta bildirimi gider.
  - **İç not** — yalnızca staff görür, talep edene **asla** gösterilmez.
  - Dosya ekleme, ticket geçmişi (kim neyi ne zaman değiştirdi), SLA sayacı.
  - **İlişkiler ve izleyiciler:**
    - **Birleştir** (`admin`, `it_manager`) — aynı konudaki mükerrer talebi başka bir talebe
      birleştirir: notlar ve dosyalar hedefe taşınır, kaynak kapanır, kaynağın talep sahibi
      hedefe CC eklenir ve bilgilendirilir. Kaynağa e-postayla gelen yanıtlar hedefe düşer.
    - **Üst/alt talep** — yaygın arızada etkilenen talepler tek bir üst talebe bağlanır
      (tek seviye). Üst talebin durumu değiştirilirken "alt taleplere de uygula" ile hepsi
      birlikte çözülür/kapatılır.
    - **İzleyiciler** — CC (talep sahibi tarafı: talep sahibine giden bildirimleri alır,
      e-postayla yanıt verebilir; şirketin izinli domain kuralına tabidir) ve personel
      izleyici ("İzle": kullanıcı yanıtlarından haberdar olur). Portalda talep açarken ve
      e-postayla gelen yeni taleplerde To/Cc'deki kişiler otomatik CC olur.
  - Buradan **yerinde destek randevusu** oluşturulabilir.

### Yerinde destek takvimi — `/staff/onsite`

Randevu tipleri: **IT Odasına Gelin**, **Toplantı Odası**, **Yerinde Müdahale**.

Randevu oluştururken **süre** seçilir ve takvimde gerçek süresiyle orantılı çizilir.
Randevular personele atanmadığı için **aynı saatte paralel randevular normaldir** —
çakışma uyarısı bilinçli olarak kaldırılmıştır.

### Görev yönetimi — `/staff/tasks`

Ticket'tan bağımsız iç görevler. Birden fazla kişiye atanabilir, yorumlanabilir, son tarih
verilebilir.

Görev durumları: `open`, `in_progress`, `done`, `cancelled`.
Görev öncelikleri: `low`, `medium`, `high`, `critical` — **ticket öncelikleriyle aynıdır**.

Liste ekranında görevler atanana, önceliğe, duruma ve metne göre filtrelenebilir; bitiş
tarihi, öncelik, oluşturma veya başlığa göre sıralanabilir. Üstteki sayaç kutucukları
tıklanabilir filtre kısayollarıdır (ör. "Süresi Geçen"). Durum, listeden doğrudan
değiştirilebilir.

---

## Yönetici işlemleri

### Şirket yönetimi — `/staff/companies` (`admin`, `it_manager`)

- **Şirket:** ad, grup tipi (`call_center`, `corporate`, `warehouse`, `retail`), logo,
  tema rengi.
- **`allowedDomains`:** ticket açabilecek e-posta domain'leri. Boşsa kısıt yok.
- **`portalDomains`:** şirketi hangi FQDN'in temsil ettiği. Bir kullanıcı o domain'den
  girdiğinde şirketin logosu ve rengi otomatik uygulanır (branding).
- **`notificationEmail`:** yeni ticket'ların düşeceği IT grup maili.
- **Lokasyonlar:** adres, kat bilgisi.
- **Kategoriler:** hiyerarşik (alt kategori), sıralanabilir, **kategori bazlı SLA**
  (yanıt ve çözüm süresi, dakika) ve **otomatik atama**.
- **Özel alanlar:** şirkete özel form alanları — tip, zorunluluk, seçenekler.
- **Şirket bazlı SMTP:** her şirket kendi SMTP'siyle mail gönderebilir. Tanımlı değilse
  global SMTP kullanılır. Panelden **test maili** gönderilebilir.
- **SLA & Mesai** (`admin`, kendi şirketlerinde `it_manager`):
  - **Mesai takvimi** — gün bazlı çalışma aralıkları (öğle arası gibi bölünmüş aralıklar
    dahil) ve saat dilimi. Açıksa SLA yalnızca mesai içinde işler; kapalıysa 7/24.
  - **Tatil günleri** — takvim açıkken SLA bu günlerde durur. Sabit tarihli tatiller tek
    tıkla sonraki yıla kopyalanır; dini bayramlar gibi kayan günler elle düzeltilir.
  - **7/24 öncelikler** — seçilen önceliklerde (ör. `critical`) takvim yok sayılır.
  - **İhlal öncesi uyarı eşiği** — süre bu yüzdeye ulaşınca (varsayılan %80) atanana,
    atanmamışsa şirketin IT yöneticilerine e-posta + panel bildirimi gider.
  - **Eskalasyon** — ihlalde yöneticilere bildirim; isteğe bağlı olarak çözüm SLA'sı
    aşılınca öncelik bir kademe yükseltilir.
  - **Otomatik kapatma** (gün, 0 = kapalı) — `Çözüldü` durumunda N gün yeniden
    açılmayan ticket kapatılır (varsayılan 7). `Kullanıcı Yanıtı Bekleniyor` için önce
    hatırlatma, sonra kapatma süresi tanımlanabilir (varsayılan kapalı). Talep sahibine
    çift dilli bildirim gider; işlem ticket geçmişine sistem kaydı olarak düşer.

- **Gelen Posta** (yalnızca `admin`) — şirketin destek posta kutusu. Talep sahibine
  giden bildirimlerde bu adres **Reply-To** olur; e-postayla verilen yanıtlar ticket'a
  kullanıcı yanıtı olarak düşer (alıntılanan eski mesaj kırpılır, ekler portal
  yüklemesiyle aynı kurallardan geçer). Kutu 2 dakikada bir kontrol edilir.
  - **Sağlayıcılar:** IMAP (kendi sunucunuz ya da uygulama şifresiyle Gmail),
    **Microsoft 365** (Entra ID uygulama kaydı, `Mail.ReadWrite` *Application* izni +
    yönetici onayı; uygulamayı Exchange *Application Access Policy* ile yalnızca bu
    posta kutusuna kısıtlayın), **Gmail / Google Workspace** (Google Cloud'da *Web
    application* OAuth istemcisi; ekranda gösterilen yönlendirme adresini ekleyip
    "Google ile bağlan").
  - **Eşleştirme:** konudaki ticket numarası (`TKT-YYYY-NNNNN`) **ve** gönderen = talep
    sahibi **ve** aynı şirket. Başka biri numarayı yazsa da not ekleyemez.
  - **Eşleşmeyen e-postalar:** ayar açıksa varsayılan kategori/lokasyonla yeni talep
    açılır (şirketin izinli domain kısıtı geçerlidir). Kapanmış talebe gelen yanıt, önceki
    numaraya atıf yapan yeni talep olur; çözülmüş talebe gelen yanıt talebi yeniden açar.
  - **Koruma:** otomatik yanıtlar / bültenler / teslim raporları, posta kutusunun kendi
    adresi ve gönderen başına saatte 30'u aşan iletiler işlenmez. Her ileti bir kez işlenir;
    son 20 iletinin sonucu (yanıt eklendi / talep açıldı / yok sayıldı + neden) ekranda görünür.
  - Sırlar (parola, client secret, Google yetkisi) şifreli saklanır ve arayüze geri dönmez.

> **SLA duraklatma:** ticket `Kullanıcı Yanıtı Bekleniyor`, `Diğer Birimden Destek
> Bekleniyor`, `Süreç IT Dışında İlerliyor` veya `Beklemede` durumundayken SLA saati
> durur; aktif duruma dönünce son tarihler bekleyen süre kadar ileri kayar. Kullanıcı
> yanıt verdiğinde ticket otomatik olarak `Açık`a döner ve saat yeniden işler. Personelin
> ilk durum değişikliği veya talep sahibine görünen ilk notu "ilk yanıt" sayılır.

> Şirket SMTP şifreleri AES-256-GCM ile şifrelenir. Eski kurulumlar için tek seferlik
> dönüşüm adımı [SECURITY.md](../SECURITY.md) içinde belgelenmiştir.

### Şablonlar — `/staff/templates` (`admin`, `it_manager`)

- **E-posta şablonları:** ticket oluşturuldu, durum değişti, atandı, not eklendi,
  randevu planlandı, SLA ihlali, SLA yaklaşıyor, SLA eskalasyonu.
- **SMS şablonları:** SMS gateway tanımlıysa.
- **Hazır yanıtlar (canned responses):** ticket detayında tek tıkla eklenen kalıp metinler.

### Raporlar — `/staff/reports` (`admin`, `it_manager`)

Ticket dağılımı, personel performansı, kategori kırılımı, genel bakış, SLA trendleri ve
**CSV export**.

### Personel yönetimi — `/staff/staff-management` (yalnızca `admin`)

Personel ekleme/düzenleme/silme, rol atama ve **şirket kapsamı** belirleme. Tüm işlemler
audit log'a yazılır.

#### SSO / Dizin — kimlik sağlayıcılar

Personel girişi için **OpenID Connect** (Entra ID, Keycloak, Google Workspace…),
**SAML 2.0** (ADFS vb.) ve **LDAP / Active Directory** tanımlanabilir. Giriş ekranında her
aktif sağlayıcı için bir düğme görünür.

- **OIDC:** IdP'de *Web* uygulaması oluşturun, ekranda gösterilen **redirect URI**'yi
  ekleyin (`https://<alan>/api/auth/sso/<kısa-ad>/callback`). Grup bilgisi için IdP'nin
  `groups` (Entra'da grup/uygulama rolü) claim'ini açın. Issuer HTTPS olmalıdır.
- **SAML:** IdP'ye **ACS** (`…/acs`) ve **metadata** (`…/metadata`) adreslerini tanıtın;
  IdP imza sertifikasını yapıştırın. İmzasız ve istenmemiş (IdP-initiated) yanıtlar
  reddedilir.
- **LDAP/AD:** servis hesabıyla kullanıcı aranır, ardından kullanıcının kendi parolasıyla
  bind edilir. `ldaps://` önerilir (ya da `ldap://` + StartTLS).
- **Grup → rol eşlemesi:** tanımlıysa rol her girişte gruplardan belirlenir (birden çok
  eşleşmede en yüksek rol); hiçbir grubu tutmayan kullanıcı giremez — dizinde gruptan
  çıkarılan kişi erişimini kaybeder. **Grup → şirket eşlemesi** tanımlıysa şirket
  atamaları her girişte yenilenir.
- **JIT:** açıksa, bir rol grubu tutan ama sistemde kaydı olmayan kullanıcı için ilk
  girişte personel kaydı açılır. Aynı e-postalı mevcut hesap ilk SSO girişinde bağlanır.
- **Yerel parola girişini kapat:** personel yalnızca SSO ile girer; **admin hesapları acil
  durum için yerel girişi korur** (giriş ekranındaki "Yönetici girişi" bağlantısı). SSO
  girişlerinde ikinci faktör (MFA) kimlik sağlayıcıda uygulanır.
- Kurum içi IdP / dizin sunucuları için `.env`'de `ALLOW_PRIVATE_INTEGRATION_HOSTS=true`
  gerekir (varsayılan olarak iç ağ adreslerine bağlantı engellidir).

---

### Entegrasyonlar — `/staff/integrations` (yalnızca `admin`)

Talep olaylarını dış kanallara iletir: **Microsoft Teams** (kanalda *Workflows → "Post to a
channel when a webhook request is received"* ile alınan adres), **Slack** (Incoming Webhook)
ve **genel webhook** (n8n, Power Automate, kendi servisiniz).

- **Olaylar:** talep oluşturuldu, durum/öncelik/atama değişti, IT public yanıtı, kullanıcı
  yanıtı, SLA yaklaşıyor, SLA ihlali. Entegrasyon tüm şirketler ya da tek şirket için olabilir.
- **İç notlar ve talep sahibinin takip bağlantısı hiçbir kanala gönderilmez**; mesajlar
  personel bağlantısı (oturum gerektirir) içerir.
- **Genel webhook imzası:** gövde JSON'dur; `X-Ticket-Event`, `X-Ticket-Delivery`,
  `X-Ticket-Timestamp` ve `X-Ticket-Signature: sha256=<HMAC-SHA256(sır, "zaman.gövde")>`
  başlıkları gönderilir. Sır kayıttan sonra **bir kez** gösterilir; yenilenebilir. Alıcı,
  zaman damgası eski (ör. 5 dakikadan eski) isteği reddetmelidir.
- **Teslimat:** kuyrukla, 5 deneme ve üstel bekleme; yönlendirmeler izlenmez, hedef her
  teslimatta SSRF denetiminden geçer. Son 30 teslimat, hata ve "yeniden dene" sayfada görünür.
  Kurum içi hedefler için `ALLOW_PRIVATE_INTEGRATION_HOSTS=true` gerekir.

## Şifre kasası

`/staff/passwords` — **`admin` ve `it_manager`**.

- **`admin`** tüm kayıtları görür.
- **`it_manager`** yalnızca **atandığı şirketlerin** kayıtlarını görür ve yalnızca o
  şirketler için yeni kayıt ekleyebilir.
- **Şirkete bağlı olmayan ("global") kayıtlar yalnızca `admin`'e görünür.** Global kayıtlar
  (domain admin, root şifreleri gibi) çapraz şirket sırları olma eğilimindedir; bu yüzden
  `it_manager` bunları ne görebilir ne oluşturabilir.

Kurumsal şifreleri (sunucu, lisans, servis hesapları) saklamak için. Hash'lenmez, çünkü
şifrelerin tekrar görüntülenebilmesi gerekir; bunun yerine **AES-256-GCM** ile şifrelenir.

- Yalnızca **şifre** ve **notlar** şifrelenir. Başlık, kategori, URL ve kullanıcı adı düz
  metindir (arama yapılabilsin diye).
- Liste ekranı şifreleri **hiçbir zaman** döndürmez — maskeli gösterilir.
- "Göster" dendiğinde şifre sunucuda çözülür, ekranda birkaç saniye sonra otomatik gizlenir
  ve **her görüntüleme audit log'a yazılır**.
- Panoya kopyalama, arama ve filtreleme desteklenir.

> **Kritik:** Şifreleme anahtarı `CREDENTIALS_ENC_KEY` ortam değişkenindedir ve veritabanında
> **tutulmaz**. Anahtarı kaybedersen veya değiştirirsen kasadaki tüm kayıtlar kalıcı olarak
> çözülemez hale gelir. Veritabanı yedeğinin yanında anahtarı da güvenli bir yerde yedekle —
> ama **aynı yerde değil**.

---

## İlk kurulum sonrası yapılacaklar

1. **Seed şifrelerini değiştir.** `admin123` / `staff123` demo içindir. Production'da seed
   çalıştırdıysan hemen değiştir; çalıştırmadıysan ilk admin'i elle oluştur.
2. **Şirketlerini tanımla** — lokasyonlar, kategoriler ve kategori bazlı SLA süreleri.
3. **Özel alanları kur** — her şirketin ticket formunda hangi ek bilgileri isteyeceğini
   belirle.
4. **SMTP'yi test et** — global SMTP'yi doğrula, gerekiyorsa şirket bazlı SMTP tanımla ve
   panelden test maili gönder. E-posta çalışmazsa talep edenler erişim linklerini alamaz.
5. **Personeli ekle ve şirket kapsamlarını ata** — kapsam atamazsan `it_staff` tüm şirketleri
   görür.
6. **E-posta şablonlarını düzenle** — varsayılanlar çalışır ama kurumunun diline göre gözden
   geçir.
7. **`CREDENTIALS_ENC_KEY`'i yedekle** — şifre kasasını kullanacaksan.
