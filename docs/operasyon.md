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

## Veri saklama

Retention komutu varsayılan olarak yalnızca rapor üretir:

```bash
docker compose exec backend npm run db:retention:check
docker compose exec backend npm run db:retention:apply
```

`RETENTION_CLOSED_TICKET_DAYS` varsayılan olarak 365 gündür ve 30 günden küçük olamaz.
Silme öncesinde backup alın. İlk çalıştırmada `check` çıktısındaki dosya sayısı ve byte
toplamını onaylamadan `apply` çalıştırmayın.

## Sağlık ve kapanış

- `/health/live`: Node.js process'i cevap veriyor mu.
- `/health/ready`: PostgreSQL ve Redis istek kabul ediyor mu.
- `SIGTERM`/`SIGINT`: HTTP, worker, queue, Redis ve Prisma bağlantıları en fazla 30 saniye
  içinde kontrollü kapatılır.

Alarm başlangıçları: readiness 2 dakika başarısız, disk kullanımı yüzde 80, son başarılı
backup 26 saatten eski ve failed notification sayısında olağan dışı artış.
