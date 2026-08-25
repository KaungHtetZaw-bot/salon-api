# ── Stage 1: build ────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npx prisma generate          # needs schema + config only

COPY tsconfig.json ./
COPY src ./src
RUN npm run build                # emits dist/ (incl. compiled prisma client)

# ── Stage 2: slim runtime ─────────────────────────────────────
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY prisma.config.ts ./
COPY prisma ./prisma             # migrations for `prisma migrate deploy`
COPY --from=build /app/dist ./dist

EXPOSE 4000
# Apply pending migrations, then boot.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/server.js"]
