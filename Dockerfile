# Pelo CRM — one build, two runtime images: `api` (API + worker) and `web` (Caddy + PWA).
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS api
RUN apk upgrade --no-cache # pick up base-image security fixes at build time
ARG APP_VERSION=dev
ENV NODE_ENV=production APP_VERSION=$APP_VERSION
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev -w @baton/api && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
# ↑ the runtime only runs `node`; package managers are not shipped (smaller image, fewer scanner findings)
COPY --from=build /src/apps/api/dist apps/api/dist
COPY apps/api/migrations apps/api/migrations
RUN mkdir -p /data && chown node /data
USER node
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "dist/server.js"]

# Caddy rebuilt with the current Go toolchain: the upstream binary can lag behind Go security fixes (CI scans it).
FROM golang:1-alpine AS caddy
RUN CGO_ENABLED=0 go install -trimpath -ldflags='-s -w' github.com/caddyserver/caddy/v2/cmd/caddy@latest

FROM caddy:2-alpine AS web
RUN apk upgrade --no-cache
COPY --from=caddy /go/bin/caddy /usr/bin/caddy
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/apps/web/dist /srv
