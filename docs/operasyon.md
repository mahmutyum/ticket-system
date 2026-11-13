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

## Otomatik yedekleme (v1.2)

`backup` servisi (opsiyonel compose profili) yedeklemeyi zamanlar, uzak hedeflere
yükler ve restore provası yapar. Elle script akışı (`backup.sh`/`restore.sh`) aynı
formatta korunur ve her zaman geçerli bir kurtarma yoludur.

```bash
docker compose --profile backup up -d
```

- **Hedefler** panelden tanımlanır (`/staff/backups`, admin): hedef tipi (yerel disk,
  S3-uyumlu, Google Drive, FTPS, SFTP, WebDAV, SMB), rclone config INI (şifreli
  saklanır, API'den dönmez), hedef bazlı GFS saklama adetleri.
- **Zamanlama ve saklama varsayılanları** `BACKUP_*` ortam değişkenlerinden gelir
  (bkz. [kurulum](kurulum.md)); panelden yapılan değişiklik veritabanında saklanır ve
  önceliklidir.
- **Şifreleme:** uzak hedef varsa `BACKUP_ENCRYPTION_RECIPIENT` (age açık anahtarı)
  ZORUNLUDUR — `environment.snapshot` sır içerdiği için şifresiz uzak kopya reddedilir.
  Çözüm özel anahtarı sistemde tutulmaz; restore operatörün anahtarıyla yapılır.
- **Zamanlanmış Görevler** sayfasından yedekleme, restore provası ve tüm periyodik
  işler elle tetiklenebilir / duraklatılabilir; çalışma geçmişi kayıt altındadır.
- **Geri yükleme hâlâ yalnızca CLI'dır** (`scripts/restore.sh`) — yıkıcı işlem web'den
  tetiklenmez.

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

## Metrikler (Prometheus)

`METRICS_TOKEN` tanımlıysa backend `/metrics` ucunu Bearer token ile yayınlar (boşsa uç
yoktur). Prometheus'u backend'e **Docker ağı içinden** bağlayın:

```yaml
scrape_configs:
  - job_name: ticket-system
    metrics_path: /metrics
    authorization: { type: Bearer, credentials: "<METRICS_TOKEN>" }
    static_configs: [{ targets: ["backend:4000"] }]
```

| Metrik | Anlamı |
|---|---|
| `ticket_http_request_duration_seconds` | HTTP süre histogramı (`method`, `route` şablonu, `status`) |
| `ticket_http_errors_total` | 5xx yanıtlar |
| `ticket_queue_jobs{queue,state}` | BullMQ işleri: email, sms, sla-check, mail-fetch, webhook × waiting/active/delayed/failed |
| `ticket_notifications_failed{type}` | Kalıcı başarısız e-posta/SMS |
| `ticket_sla_breaches_open{kind}` | Çözülmemiş ve SLA'sı ihlal edilmiş ticket'lar |
| `ticket_open_tickets` | Açık ticket sayısı |
| `ticket_webhook_deliveries_failed` | Son 24 saatteki başarısız webhook teslimatları |
| `ticket_mailbox_errors` | Son çekmede hata veren gelen posta kutuları |
| `ticket_sse_connections{type}` | Açık SSE bağlantıları |
| `ticket_process_*`, `ticket_nodejs_*` | Süreç ve Node.js varsayılanları |

Örnek alarm kuralları:

```yaml
groups:
  - name: ticket-system
    rules:
      - alert: TicketBackendDown
        expr: up{job="ticket-system"} == 0
        for: 2m
      - alert: TicketHighErrorRate
        expr: sum(rate(ticket_http_errors_total[5m])) / sum(rate(ticket_http_request_duration_seconds_count[5m])) > 0.05
        for: 10m
      - alert: TicketQueueBacklog
        expr: ticket_queue_jobs{state="waiting"} > 100
        for: 15m
      - alert: TicketQueueFailures
        expr: increase(ticket_queue_jobs{state="failed"}[1h]) > 10
      - alert: TicketNotificationsFailing
        expr: increase(ticket_notifications_failed[1h]) > 5
      - alert: TicketMailboxError
        expr: ticket_mailbox_errors > 0
        for: 15m
      - alert: TicketSlaBreaches
        expr: sum(ticket_sla_breaches_open) > 10
        for: 30m
```

## Sağlık ve kapanış

- `/health/live`: Node.js process'i cevap veriyor mu.
- `/health/ready`: PostgreSQL ve Redis istek kabul ediyor mu.
- `SIGTERM`/`SIGINT`: HTTP, worker, queue, Redis ve Prisma bağlantıları en fazla 30 saniye
  içinde kontrollü kapatılır.

Alarm başlangıçları: readiness 2 dakika başarısız, disk kullanımı yüzde 80, son başarılı
backup 26 saatten eski ve failed notification sayısında olağan dışı artış. "26 saatten
eski backup" alarmı v1.2'den itibaren `ticket_backup_last_success_timestamp` metriğiyle
otomatik izlenir (yedek hiç alınmadıysa değer 0'dır ve alarm yine tetiklenir).

## Deploy öncesi production kontrolü

```bash
./scripts/check-production-env.sh .env
docker compose config --quiet
```

Kontrol; eksik/`changeme_*` secret'ları, development modu, aynı veya kısa JWT
anahtarlarını, hatalı kasa anahtarını ve HTTPS olmayan `APP_URL` değerini reddeder.
API dokümantasyonu açık kaldıysa ayrıca uyarır.
