# Tasarım: Takvim Düzeltmeleri + Şifreler Modülü

Tarih: 2026-06-26
Durum: Onaylandı

## Genel Bakış

İki bağımsız iş kalemi:

1. **Takvim düzeltmeleri** — Yerinde destek takviminde saatlik gösterim ve aynı
   saatteki çoklu randevuların doğru görüntülenmesi.
2. **Şifreler modülü** — Sadece `admin` rolünün eriştiği, hizmet/servis kullanıcı
   adı–şifrelerinin DB'de şifreli (AES-256-GCM) tutulduğu yeni bir modül.

---

## Bölüm 1 — Takvim Düzeltmeleri

### Kök nedenler (mevcut `frontend/src/pages/staff/OnsiteSupportPage.tsx`)

- Tüm randevular sabit `DEFAULT_DURATION_MIN = 15` ile çiziliyor; DB'deki
  `scheduledEnd` alanı yok sayılıyor.
- `minHeight: 64` her kartı tam saat yüksekliğine zorluyor → kısa (10–15 dk)
  randevular görsel olarak bir sonraki saate taşıp üst üste biniyor.
- Aynı saatteki her örtüşme `conflict` (kırmızı + `AlertTriangle`) olarak
  işaretleniyor; oysa paralel randevular normal kabul edilecek.

### Karar

- Randevu bir teknisyene atanmaz. Aynı saatteki birden fazla randevu **normal
  paralel durumdur**, çakışma uyarısı kaldırılır.
- Randevu süresi oluşturma sırasında seçilir ve `scheduledEnd` olarak yazılır.

### Değişiklikler

**Randevu oluşturma — `frontend/src/pages/staff/TicketDetailPage.tsx`**

- `onsiteForm` state'ine `durationMin` eklenir (varsayılan `15`).
- Forma süre seçici eklenir: 10 / 15 / 30 / 60 dk.
- Create isteğinde `scheduledEnd = new Date(scheduledAt + durationMin*60000)`
  ISO olarak gönderilir. Backend şeması (`scheduledEnd` optional) zaten hazır;
  backend değişikliği gerekmez.
- Form reset'i `durationMin: 15` içerecek şekilde güncellenir.

**Takvim görünümü — `frontend/src/pages/staff/OnsiteSupportPage.tsx`**

- `computeLayout`: her event'in gerçek süresi `scheduledEnd`'den hesaplanır
  (`(end - start)/60000`); `scheduledEnd` yoksa 15 dk fallback. Lane atama
  gerçek `[start, end)` aralıklarına göre yapılır.
- Çakışma semantiği kaldırılır: `LayoutItem.conflict` ve ilgili kırmızı stiller,
  `AlertTriangle` işaretleri ve `hasDayConflict` kullanımı temizlenir. Hafta
  şeridindeki günlük adet rozeti korunur.
- Kart yüksekliği süreyle orantılı: `height = (durationMin/60)*HOUR_HEIGHT`,
  okunabilirlik için `Math.max(height, 28)` alt sınırı. `minHeight: 64` kaldırılır.
- Kısa kartlar yalın içerik (saat + konu) gösterir; hover'da genişleyip detay
  açılır (mevcut `hover:overflow-visible` davranışı korunur).
- `HOUR_HEIGHT` 64 → 80px (15 dk ≈ 20px daha okunur).

### Test / doğrulama

- Aynı saatte 3 farklı randevu → 3 kolon yan yana, kırmızı uyarı yok.
- 10 dk ve 60 dk randevular farklı yükseklikte çizilir; kısa kart sonraki saate
  taşmaz.
- `scheduledEnd` olmayan eski kayıtlar 15 dk fallback ile bozulmadan çizilir.

---

## Bölüm 2 — Şifreler Modülü (Credential Vault)

### Erişim / kapsam

- Yalnızca `admin` rolü erişir (`requireRole('admin')` + frontend
  `ProtectedRoute allowedRoles={['admin']}`).
- Her kayıt opsiyonel olarak bir `Company`'ye bağlanabilir; şirkete göre
  filtreleme.

### Veri modeli — `backend/prisma/schema.prisma`

```prisma
model CredentialEntry {
  id          String   @id @default(cuid())
  companyId   String?  @map("company_id")
  title       String                         // hizmet/servis adı
  category    String?                        // "Sunucu", "Ağ", "SaaS"...
  url         String?
  username    String?
  passwordEnc String   @map("password_enc")  // AES-256-GCM şifreli
  notesEnc    String?  @map("notes_enc")      // opsiyonel şifreli not
  createdById String   @map("created_by_id")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  company Company? @relation(fields: [companyId], references: [id])

  @@index([companyId])
  @@map("credential_entries")
}
```

- `Company` modeline ters ilişki eklenir: `credentialEntries CredentialEntry[]`.
- Prisma migration üretilir.

### Şifreleme — `backend/src/utils/crypto.ts`

- **AES-256-GCM** (geri döndürülebilir; şifre tekrar gösterilebilmeli — hash uygun
  değil).
- Anahtar `config.CREDENTIALS_ENC_KEY` (hex, 32 byte → 64 karakter).
- `encrypt(plain: string): string` → `iv:authTag:ciphertext` (her parça base64).
- `decrypt(payload: string): string` → düz metin.
- Sadece `password` ve `notes` şifrelenir; `title/category/url/username` düz metin.

### Config — `backend/src/config/index.ts`

- `envSchema`'ya `CREDENTIALS_ENC_KEY: z.string().length(64)` eklenir.
- `docker-compose.yml` / örnek env'e değişken eklenir (repo'ya gizli değer yazılmaz).

### Backend modülü — `backend/src/modules/credentials/credentials.routes.ts`

Tüm route'lar `preHandler: [app.requireRole('admin')]`.

- `GET /credentials?companyId=` → liste. **Şifre/not dönmez** (maskelenir);
  sadece metadata: `id, title, category, url, username, companyId, company.name`.
- `GET /credentials/:id/reveal` → `{ password, notes }` çözülmüş döner.
  `createAuditLog({ action: 'credential_reveal', entityType: 'credential', ... })`.
- `POST /credentials` → oluştur (password/notes şifrelenir). Audit log.
- `PUT /credentials/:id` → güncelle (password verilirse yeniden şifrelenir). Audit log.
- `DELETE /credentials/:id` → sil. Audit log.
- Zod şemaları ile body doğrulama.

`backend/src/app.ts`'e route kaydı eklenir (örn. prefix `/credentials`).

### Frontend — `frontend/src/pages/staff/PasswordsPage.tsx`

- Route `frontend/src/App.tsx`: `/staff/passwords`,
  `ProtectedRoute allowedRoles={['admin']}`.
- `frontend/src/components/layout/StaffLayout.tsx`: yalnızca `admin`'e görünen
  "Şifreler" menü linki.
- Tablo: başlık, kategori, kullanıcı adı, şirket, maskelenmiş şifre.
  - "Göster" butonu → reveal endpoint'i çağırır, şifre birkaç saniye gösterilip
    otomatik gizlenir.
  - Kopyala butonu (clipboard).
- Ekle/düzenle modalı (başlık, kategori, şirket seçimi, url, kullanıcı adı, şifre,
  not), silme onayı.
- Başlık / şirket / kategoriye göre arama–filtre.

### Güvenlik notları

- Liste endpoint'i hiçbir zaman şifre döndürmez; şifre yalnızca açık `reveal`
  isteğinde gelir ve audit log'lanır.
- Şifreleme anahtarı yalnızca env'de; repo veya DB'de tutulmaz.
- Mevcut `CompanySmtp.pass` düz metin tutuluyor — bu işin kapsamı dışında, ayrı
  bir iyileştirme olarak not edildi.

### Test / doğrulama

- `admin` dışı rol `/credentials` ve `/staff/passwords`'a erişemez (403 / redirect).
- Oluşturulan kayıtta `password_enc` DB'de okunabilir düz metin değil.
- `reveal` doğru şifreyi döner ve audit log üretir.
- Anahtar yanlış/eksikse uygulama açılışta net hata verir.
