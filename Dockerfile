# ── Stage 1: Build the Vite frontend ──────────────────────────────────────────
FROM node:25-alpine AS build
WORKDIR /app
RUN apk upgrade --no-cache
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 2: Install production dependencies ──────────────────────────────────
FROM node:25-alpine AS prod-deps
WORKDIR /app
RUN apk upgrade --no-cache
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 3: Production image ─────────────────────────────────────────────────
FROM gcr.io/distroless/nodejs22-debian12:nonroot
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY src/teamNames.json ./src/teamNames.json
COPY --from=build /app/dist ./dist

EXPOSE 3001
CMD ["server.js"]
