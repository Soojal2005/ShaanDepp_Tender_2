# One image holds the API and the built website; Caddy (see docker-compose.prod.yml) puts HTTPS in front.

# ---- 1. Build the website ------------------------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /web
COPY package.json package-lock.json ./
# --ignore-scripts: the root "postinstall" installs the API's packages, which this stage does not need.
RUN npm ci --ignore-scripts
COPY index.html vite.config.js ./
COPY public ./public
COPY scripts ./scripts
COPY src ./src
ARG SITE_URL=https://procure-brain.com
ENV SITE_URL=$SITE_URL
RUN npm run build

# ---- 2. Generate the platform-independent Prisma client --------------------------------------
FROM node:22-alpine AS api-build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY backend/prisma ./prisma
COPY backend/prisma.config.mjs ./
RUN npm run db:generate && npm prune --omit=dev --ignore-scripts && node -e "require('@prisma/client').PrismaClient"

# ---- 3. API + built website -----------------------------------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/backend
COPY --from=api-build /app/backend/package.json /app/backend/package-lock.json ./
COPY --from=api-build /app/backend/node_modules ./node_modules
COPY backend/prisma ./prisma
COPY backend/migrations ./migrations
COPY backend/seed ./seed
COPY backend/src ./src
COPY --from=web /web/dist /app/dist
RUN mkdir -p /data/storage /data/outbox && chown -R node:node /data
ENV STORAGE_DIR=/data/storage OUTBOX_DIR=/data/outbox
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/v1/health || exit 1
CMD ["node", "src/server.js"]
