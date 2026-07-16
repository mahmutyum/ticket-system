# Operasyon rehberi

## Yedekleme ve geri dönüş

PostgreSQL, `uploads` volume'u ve `.env` içindeki `CREDENTIALS_ENC_KEY` birlikte korunmalıdır.
Anahtar olmadan şifre kasası geri getirilemez.

```bash
BACKUP_DIR=/guvenli/hedef ./scripts/backup.sh
./scripts/restore.sh /guvenli/hedef/20260716T120000Z
```

Backup hedefini disk seviyesinde şifreleyin, yalnızca operatörlere açın ve farklı bir
makine/bölgede ikinci kopya tutun. Önerilen başlangıç hedefi günlük backup, 30 günlük
saklama ve ayda bir izole ortamda restore provasıdır.

Her yedek `SHA256SUMS` bütünlük manifesti içerir. Restore başlamadan önce manifest,
PostgreSQL dump kataloğu ve uploads arşivi doğrulanır; doğrulama başarısızsa mevcut
veriye dokunulmaz. Restore sırasında backend durdurulur ve işlem hata verse bile
yeniden başlatılır. `environment.snapshot` secret içerir ve otomatik olarak aktif
`.env` üzerine yazılmaz; anahtarları operatör ayrıca karşılaştırmalıdır.

## Veri saklama

Retention komutu varsayılan olarak yalnızca rapor üretir:

```bash
docker compose exec backend npm run db:retention:check
docker compose exec backend npm run db:retention:apply
```

`RETENTION_CLOSED_TICKET_DAYS` varsayılan olarak 365 gündür ve 30 günden küçük olamaz.
Silme öncesinde backup alın. İlk çalıştırmada `check` çıktısındaki dosya sayısı ve byte
toplamını onaylamadan `apply` çalıştırmayın.

Otomatik raporlama için host cron/systemd timer ile her gün yalnızca check modunu
çalıştırın; `apply` insan onayı olmadan zamanlanmamalıdır:

```cron
15 3 * * * cd /opt/ticket-system && docker compose exec -T backend npm run db:retention:check >> /var/log/ticket-retention.log 2>&1
```

Silme işlemi için bakım penceresinde güncel backup sonrası `db:retention:apply`
çalıştırın. Çıktı JSON'dur ve merkezi log/uyarı sistemi tarafından izlenebilir.

## Sağlık ve kapanış

- `/health/live`: Node.js process'i cevap veriyor mu.
- `/health/ready`: PostgreSQL ve Redis istek kabul ediyor mu.
- `SIGTERM`/`SIGINT`: HTTP, worker, queue, Redis ve Prisma bağlantıları en fazla 30 saniye
  içinde kontrollü kapatılır.

Alarm başlangıçları: readiness 2 dakika başarısız, disk kullanımı yüzde 80, son başarılı
backup 26 saatten eski ve failed notification sayısında olağan dışı artış.

## Deploy öncesi production kontrolü

```bash
./scripts/check-production-env.sh .env
docker compose config --quiet
```

Kontrol; eksik/`changeme_*` secret'ları, development modu, aynı veya kısa JWT
anahtarlarını, hatalı kasa anahtarını ve HTTPS olmayan `APP_URL` değerini reddeder.
API dokümantasyonu açık kaldıysa ayrıca uyarır.
