# Build from the repository root so the workspace packages are available:
#   docker build -f services/sync-service/Dockerfile -t sonolect-sync-service .

FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages packages
COPY tooling/service-build tooling/service-build
COPY services/sync-service services/sync-service
RUN pnpm install --frozen-lockfile --filter "@sonolect/sync-service..."
# Bundle the service and the workspace packages it uses into dist/index.js,
# then collect only its production dependencies.
RUN pnpm --filter "@sonolect/sync-service" build \
  && pnpm --filter "@sonolect/sync-service" deploy --prod /out

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
# Drop root before running the service.
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
