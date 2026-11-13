# Yedekleme servisi (v1.2) — backend imajını pg_dump/rclone/age ile şişirmeden
# ayrı, küçük bir konteyner. Node 22 (backend ile aynı), araçlar Alpine paketleri.
FROM node:22-alpine

# pg_dump/psql  : database.dump üretimi + restore provası (istemci sürümü
#                 postgres16 olmalı — sunucu 16 ile eşleşir, sürüm uyarısı çıkmasın)
# rclone        : tüm uzak yedek hedefleri (S3/GDrive/FTPS/SFTP/WebDAV/SMB)
# age           : uzak hedefe yükleme öncesi zorunlu arşiv şifrelemesi
RUN apk add --no-cache postgresql16-client rclone age

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY lib.mjs worker.mjs ./

CMD ["node", "worker.mjs"]
