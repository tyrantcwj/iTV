FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim AS kit
WORKDIR /kit
COPY vendor/ityc-kit/package.json vendor/ityc-kit/package-lock.json* ./
RUN npm install
COPY vendor/ityc-kit/ ./
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 make g++ tar ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
COPY --from=kit /kit/dist ./vendor/ityc-kit/dist
COPY --from=kit /kit/package.json ./vendor/ityc-kit/package.json
WORKDIR /app/vendor/ityc-kit
RUN npm install --omit=dev
WORKDIR /app/server
RUN npm install --omit=dev
COPY --from=web /web/dist ./public

ARG BUILD_COMMIT=dev
ENV BUILD_COMMIT=$BUILD_COMMIT
ENV PORT=8787
ENV DATA_DIR=/app/data
ENV NODE_ENV=production
ENV ITYC_APP_ROOT=/app
ENV ITYC_REPO=tyrantcwj/iTV
ENV ITYC_CONTAINER_NAME=itv
WORKDIR /app/server
EXPOSE 8787
CMD ["npx", "tsx", "src/index.ts"]
