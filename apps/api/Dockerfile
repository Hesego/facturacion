# API del flujo de gastos. Se construye desde la raíz del repo:
#   docker compose build api
FROM node:22.14-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

FROM base AS construccion
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @gastos/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @gastos/api build \
 && pnpm --filter @gastos/api deploy --prod /salida \
 && cp -r apps/api/dist /salida/dist

FROM node:22.14-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=construccion /salida ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:3000/api/salud || exit 1
CMD ["node", "dist/servidor.js"]
