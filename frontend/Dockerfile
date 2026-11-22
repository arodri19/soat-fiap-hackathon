# syntax=docker/dockerfile:1

# ---------- build da SPA ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.ts tsconfig*.json env.d.ts ./
COPY public ./public
COPY src ./src
RUN npm run build

# ---------- runtime: nginx sem root servindo arquivos estáticos ----------
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=0755 docker/40-config.sh /docker-entrypoint.d/40-config.sh
COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
