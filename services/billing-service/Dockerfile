# Build from the repository root so the workspace packages are available:
#   docker build -f services/billing-service/Dockerfile -t sonolect-billing-service .

FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
# pnpm verifies the patches named in package.json on every install.
COPY patches patches
COPY packages packages
COPY tooling/service-build tooling/service-build
COPY services/billing-service services/billing-service
RUN pnpm install --frozen-lockfile --filter "@sonolect/billing-service..."
# Bundle the service and the workspace packages it uses into dist/index.js,
# then collect only its production dependencies.
RUN pnpm --filter "@sonolect/billing-service" build \
  && pnpm --filter "@sonolect/billing-service" deploy --prod /out

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
