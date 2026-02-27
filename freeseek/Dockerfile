FROM node:20-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.renderer.json vite.config.ts ./
COPY src/ ./src/
RUN npm run build

FROM node:20-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

EXPOSE 3000 3001

ENV PORT=3000
ENV ADMIN_PORT=3001
ENV HOST=0.0.0.0

CMD ["node", "dist/main/server-standalone.js"]
