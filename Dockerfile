# Stage 1: Frontend build
FROM node:20-alpine AS frontend-builder
WORKDIR /app/client
COPY client/package.json client/yarn.lock ./
RUN yarn install --frozen-lockfile
COPY client/ ./
RUN yarn build

# Stage 2: Backend build
FROM node:20-alpine AS backend-builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY prisma ./prisma
RUN yarn prisma generate
COPY . .
COPY --from=frontend-builder /app/client/dist ./client/dist
RUN yarn build

# Stage 3: Production
FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=backend-builder /app/dist ./dist
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/package.json ./
COPY --from=backend-builder /app/prisma ./prisma
COPY --from=backend-builder /app/client/dist ./client/dist
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "yarn prisma migrate deploy && node dist/main"]
