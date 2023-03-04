# Build
FROM node:18-alpine AS builder

WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# App
FROM node:18-alpine as app

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /build/dist ./dist
CMD ["node", "dist/index.js"]
