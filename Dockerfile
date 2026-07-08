FROM node:24-alpine AS base
RUN corepack enable && corepack prepare yarn@1.22.22 --activate

# Stage 1: Frontend build
FROM base AS frontend-builder
WORKDIR /app/client
COPY client/package.json client/yarn.lock ./
RUN yarn install --frozen-lockfile
COPY client/ ./
RUN yarn build

# Stage 2: Backend build
FROM base AS backend-builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY prisma.config.ts ./
COPY prisma ./prisma
ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres?schema=public
RUN yarn prisma generate
COPY . .
COPY --from=frontend-builder /app/client/dist ./client/dist
RUN yarn build

# Stage 3: Production
FROM base AS runner
WORKDIR /app
COPY --from=backend-builder /app/dist ./dist
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/package.json ./
COPY --from=backend-builder /app/prisma.config.ts ./
COPY --from=backend-builder /app/prisma ./prisma
COPY --from=backend-builder /app/client/dist ./client/dist
ENV NODE_ENV=production
ENV PORT=20000
EXPOSE 20000
CMD ["sh", "-c", "yarn prisma migrate deploy && node dist/main"]
