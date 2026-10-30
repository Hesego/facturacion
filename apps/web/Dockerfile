# Interfaz web. Se construye desde la raíz del repo (necesita packages/shared y brand/):
#   docker compose build web
FROM node:22.14-alpine AS construccion
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @gastos/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
COPY brand brand
RUN pnpm --filter @gastos/web build

FROM nginx:1.27.3-alpine
# Plantilla: nginx sustituye ${API_UPSTREAM} al arrancar (en Portainer es fact-api:3000)
ENV API_UPSTREAM=api:3000
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=construccion /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
