FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY backend/prisma ./prisma
RUN npx prisma generate
COPY backend/tsconfig*.json backend/nest-cli.json ./
COPY backend/src ./src
RUN npm run build

FROM build AS runtime-deps
RUN npm prune --omit=dev --no-audit --no-fund && npm install --no-save --omit=dev --no-audit --no-fund prisma@$(node -p "require('./package-lock.json').packages['node_modules/prisma'].version")

FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY deploy/bootstrap.cjs ./bootstrap.cjs
COPY deploy/platform-api.cjs ./platform-api.cjs
ENV NODE_ENV=production
USER node
CMD ["node", "dist/src/main.js"]
