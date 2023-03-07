# Build
FROM node:18-bullseye-slim AS builder

RUN apt-get update && apt-get install -y \
  python3 \
  build-essential \
  libcairo2-dev \
  libpango1.0-dev \
  libjpeg-dev \
  libgif-dev \
  librsvg2-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

RUN apt-get remove -y \
  python3 \
  build-essential

# App
FROM node:18-bullseye-slim as app

RUN apt-get update && apt-get install -y \
  libcairo2 \
  libpango1.0-dev \
  libgif-dev \
  librsvg2-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
RUN npm prune --omit=dev
CMD ["node", "dist/index.js"]
