FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build
WORKDIR /app
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.30.2-alpine@sha256:5f979dcfed4ce6461873f087e8c980d6e29b084b9e8776d9704a7e989b5f4898
ARG BUILD_COMMIT=unknown
LABEL org.opencontainers.image.revision=$BUILD_COMMIT
RUN apk add --no-cache openssl \
  && mkdir -p /etc/nginx/certs \
  && openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout /etc/nginx/certs/medtech.key \
    -out /etc/nginx/certs/medtech.crt \
    -subj "/CN=medtech-local" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  && chown -R nginx:nginx /etc/nginx/certs /var/cache/nginx /run \
  && chmod 600 /etc/nginx/certs/medtech.key
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html
USER nginx
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
EXPOSE 8080 8443
