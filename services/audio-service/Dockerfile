FROM node:26-slim
WORKDIR /app
COPY . .
# Node 25+ images no longer ship corepack; install it from npm first.
RUN npm install -g corepack@0.36.0 && corepack enable && pnpm install --frozen-lockfile && pnpm build
# Drop root before running the service.
USER node
CMD ["node", "dist/index.js"]
