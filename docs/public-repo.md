# Public depo güvenliği

Bu depo kaynak kodu, migration'ları, örnek yapılandırmayı ve kullanıcı/operasyon
dokümantasyonunu yayınlar. Çalışan bir kuruluma ait veri veya kimlik bilgisi içermez.

## Repoda bulunması gerekenler

- Uygulama kaynak kodu ve testler
- Prisma şeması ve tekrar üretilebilir migration SQL'leri
- `package-lock.json` gibi kilit dosyaları
- Gerçek değer içermeyen `.env.example`
- Docker/Nginx yapılandırma şablonları
- Kurulum, operasyon, güvenlik ve katkı belgeleri
- Yalnızca sentetik veri üreten geliştirme seed'i

## Repoda bulunmaması gerekenler

- `.env` dosyaları veya gerçek secret/token/API anahtarı
- Özel anahtar, sertifika paketi veya keystore
- Veritabanı dump'ı, yedek, SQLite dosyası
- Kullanıcı yüklemeleri, loglar, hata dökümleri ve destek kayıtları
- Gerçek müşteri/şirket/personel adı, e-posta, telefon, domain veya IP bilgisi
- Üretim ekran görüntüsü ve gerçek ticket içeriği
- IDE, işletim sistemi, AI-agent çalışma/talimat dosyaları
- Geçici planlar, sohbet dökümleri ve iç ilerleme günlükleri

`.gitignore` bu sınıfların yaygın uzantılarını engeller; ancak ignore bir güvenlik
sınırı değildir. `git add -f` veya daha önce takip edilmeye başlanmış dosyalar yine
commitlenebilir.

## Commit öncesi kontrol

```bash
./scripts/check-public-repo.sh
git diff --cached
```

GitHub Actions otomatik tetiklemeleri proje tercihi gereği kapalıdır. Actions
ekranından `CI` workflow'u elle çalıştırıldığında `Public repo — secret ve veri
dosyası kontrolü` işi aynı denetimi temiz bir clone üzerinde tekrarlar. Bu kontrol;
özel anahtar, yaygın sağlayıcı token'ları, sertifika/keystore, arşiv/yedek,
veritabanı ve yerel agent dosyalarını reddeder.

Varsa ayrıca tüm geçmişi Gitleaks veya eşdeğer bir secret scanner ile tara:

```bash
gitleaks git --redact
```

Tarayıcı sonucu temiz olsa bile diff insan gözüyle incelenmelidir. Sentetik örnekler
`company.com`, RFC 5737 dokümantasyon IP'leri ve açıkça `changeme_` ile başlayan
değerler kullanmalıdır.

Migration SQL dosyaları tekrar üretilebilir şema geçmişidir ve repoda tutulur;
üretimden alınmış `.sql` export/dump dosyaları migration klasörüne konulmamalıdır.

## Bir secret commitlendiyse

1. Secret'ı derhal sağlayıcı tarafında iptal et veya döndür.
2. Güncel daldan kaldır ve kullanıldığı sistemi denetle.
3. Gerekliyse `git filter-repo` ile tüm geçmişten temizle.
4. Force-push öncesi katkıda bulunanlarla koordine ol; tüm klonların yeniden
   alınması gerekir.

Geçmişten silmek tek başına yeterli değildir: fork, clone, cache ve loglarda kopya
kalabilir. Bu nedenle ilk ve zorunlu müdahale her zaman anahtar rotasyonudur.

## Git yazar bilgisi

Commit adı ve e-postası Git nesnesinin parçasıdır ve public depoda görünür. Kişisel
e-posta yayınlamak istemeyen katkıcılar commit atmadan önce GitHub `noreply` adresini
yapılandırmalıdır. Eski commitlerdeki adres ancak geçmiş yeniden yazılarak değişir.
