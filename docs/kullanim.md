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
| Personel yönetimi | — | — | — | ✅ |
| Şifre kasası | — | — | — | ✅ |

Roller: `admin` (Sistem Yöneticisi), `it_manager` (IT Yöneticisi), `it_staff` (IT Personeli).

> **Şirket kapsamı:** Staff kullanıcıları belirli şirketlere atanabilir; atandıklarında
> yalnızca o şirketlerin ticket'larını görürler. **Hiçbir şirkete atanmamış bir `it_staff`
> tüm şirketleri görür** — geriye dönük uyumluluk için bırakılmış bir davranış. Kısıt
> istiyorsan personeli en az bir şirkete ata. Bkz. [SECURITY.md](../SECURITY.md).

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
Görev öncelikleri: `low`, `medium`, `high`, `urgent`.

> Görev öncelikleri ticket önceliklerinden **farklıdır**: ticket'ta `critical` varken
> görevde `urgent` kullanılır.

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

> ⚠️ Şirket SMTP şifreleri veritabanında **düz metin** saklanır (panelde maskelenir ama
> şifrelenmez). Bkz. [SECURITY.md](../SECURITY.md).

### Şablonlar — `/staff/templates` (`admin`, `it_manager`)

- **E-posta şablonları:** ticket oluşturuldu, durum değişti, atandı, not eklendi,
  randevu planlandı, SLA uyarısı.
- **SMS şablonları:** SMS gateway tanımlıysa.
- **Hazır yanıtlar (canned responses):** ticket detayında tek tıkla eklenen kalıp metinler.

### Raporlar — `/staff/reports` (`admin`, `it_manager`)

Ticket dağılımı, personel performansı, kategori kırılımı, genel bakış, SLA trendleri ve
**CSV export**.

### Personel yönetimi — `/staff/staff-management` (yalnızca `admin`)

Personel ekleme/düzenleme/silme, rol atama ve **şirket kapsamı** belirleme. Tüm işlemler
audit log'a yazılır.

---

## Şifre kasası

`/staff/passwords` — **yalnızca `admin`**.

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
