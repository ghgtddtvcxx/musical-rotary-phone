FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl unzip \
 && rm -rf /var/lib/apt/lists/*
ARG XRAY_VERSION=26.9.8
ARG TARGETARCH
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) XARCH=64 ;; \
      arm64) XARCH=arm64-v8a ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fL --retry 5 --retry-all-errors "https://github.com/XTLS/Xray-core/releases/download/v${XRAY_VERSION}/Xray-linux-${XARCH}.zip" -o /tmp/xray.zip; \
    mkdir -p /opt/xray; \
    unzip -q /tmp/xray.zip xray -d /opt/xray; \
    chmod 0755 /opt/xray/xray; \
    /opt/xray/xray version; \
    rm -f /tmp/xray.zip

WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server.js ./server.js
RUN mkdir -p /data
ENV NODE_ENV=production \
    XRAY_BIN=/opt/xray/xray \
    DATA_DIR=/data \
    XRAY_LISTEN_PORT=10000 \
    XRAY_API_PORT=10085
EXPOSE 3000
CMD ["node","server.js"]
