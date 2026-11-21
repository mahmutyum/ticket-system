# Yedekleme servisi (v1.2) — backend imajını pg_dump/rclone/age ile şişirmeden
# ayrı, küçük bir konteyner. Node 24 (backend ile aynı), araçlar Alpine paketleri.
FROM node:24-alpine

# pg_dump/psql  : database.dump üretimi + restore provası (istemci sürümü
#                 postgres16 olmalı — sunucu 16 ile eşleşir, sürüm uyarısı çıkmasın)
# rclone        : tüm uzak yedek hedefleri (S3/GDrive/FTPS/SFTP/WebDAV/SMB)
# age           : uzak hedefe yükleme öncesi zorunlu arşiv şifrelemesi
RUN apk add --no-cache postgresql16-client rclone age

WORKDIR /app
# Lockfile (v1.3.2'den beri) ile deterministik kurulum.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts
COPY lib.mjs worker.mjs ./

CMD ["node", "worker.mjs"]
