FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

FROM node:22-alpine AS production-dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-alpine AS production

RUN addgroup -g 1001 -S nodeapp && \
    adduser -S uniinfo -u 1001 -G nodeapp

WORKDIR /app

RUN mkdir -p /app/backups && chown uniinfo:nodeapp /app/backups

COPY --from=production-dependencies --chown=uniinfo:nodeapp /app/node_modules ./node_modules
COPY --from=build --chown=uniinfo:nodeapp /app/dist ./dist
COPY --from=build --chown=uniinfo:nodeapp /app/package.json ./package.json

USER uniinfo

ENV NODE_ENV=production
ENV PORT=10000
ENV BACKUP_DIR=/app/backups
ENV NODE_OPTIONS="--enable-source-maps"

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget --spider -q http://localhost:10000/api/health || exit 1

CMD ["node", "/app/dist/server.cjs"]
