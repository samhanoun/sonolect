FROM node:22-slim
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile && pnpm build
# Drop root before running the service.
USER node
CMD ["node", "dist/index.js"]
