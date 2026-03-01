# ── Stage 1: Build the Vite frontend ──────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY src/teamNames.json ./src/teamNames.json
COPY --from=build /app/dist ./dist

EXPOSE 3001
CMD ["node", "server.js"]
