FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
# --include=dev: Coolify build env'inde NODE_ENV=production set olduğunda dev deps (tsc, vite) atlanmasın
RUN npm ci --include=dev

COPY . .
RUN npm run build

FROM nginx:1.25-alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 1111

CMD ["nginx", "-g", "daemon off;"]
