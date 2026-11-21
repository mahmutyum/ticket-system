FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
# --include=dev: Coolify build env'inde NODE_ENV=production set olduğunda dev deps (typescript, prisma) atlanmasın.
# --ignore-scripts: postinstall `prisma generate` şema henüz kopyalanmadan çalışmasın (aşağıda açıkça çalıştırılır).
RUN npm ci --include=dev --ignore-scripts

# Prisma 7: CLI bağlantıyı prisma.config.ts'ten okur — generate ve migrate deploy için zorunlu.
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:24-alpine

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json* ./
# --ignore-scripts: runtime'da generate gereksiz — üretilmiş istemci dist ile gelir.
RUN npm ci --omit=dev --ignore-scripts

# Prisma 7: node_modules/.prisma artık yok — istemci dist/generated altında,
# migrate deploy ise prisma.config.ts'i okur.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./

RUN mkdir -p /app/uploads

EXPOSE 4000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
