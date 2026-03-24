FROM nginx:1.25-alpine

RUN rm /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/nginx.conf
COPY conf.d/ /etc/nginx/conf.d/

# Self-signed cert placeholder (replace with real certs in production)
RUN apk add --no-cache openssl && \
    mkdir -p /etc/nginx/ssl && \
    openssl req -x509 -nodes -days 3650 \
      -subj "/C=TR/ST=Istanbul/L=Istanbul/O=Company/CN=ticket.internal.company.com" \
      -newkey rsa:2048 \
      -keyout /etc/nginx/ssl/key.pem \
      -out /etc/nginx/ssl/cert.pem && \
    apk del openssl

EXPOSE 80 443
