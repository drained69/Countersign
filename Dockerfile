# Tripwire: zero runtime dependencies, runs TypeScript directly on Node 24 (type stripping).
FROM node:24-slim

# curl + jq are needed by Kite's installer; kpass/ksearch are only used when KITE_MODE=kpass.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl jq \
 && rm -rf /var/lib/apt/lists/*

ARG INSTALL_KPASS=true
RUN if [ "$INSTALL_KPASS" = "true" ]; then \
      export KPASS_INSTALL_DIR=/opt/kpass HOME=/root \
      && curl -fsSL https://cli.gokite.ai/install.sh | bash \
      && ln -sf /opt/kpass/bin/kpass /usr/local/bin/kpass \
      && ln -sf /opt/kpass/bin/ksearch /usr/local/bin/ksearch \
      && kpass --version; \
    fi

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY deploy ./deploy
COPY policy.example.json ./

# Persistent things (receipts, calibration, the kpass login) live on a volume mounted at /data.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    TRUST_PROXY=true \
    KPASS_NO_UPDATE_CHECK=1 \
    KPASS_AUTO_UPGRADE=0
RUN mkdir -p /data/home
ENV HOME=/data/home

EXPOSE 8787
CMD ["sh", "-c", "mkdir -p \"$HOME\" && kpass agent:register --type agent --output json >/tmp/kpass-register.json 2>&1 || cat /tmp/kpass-register.json; exec node src/server.ts"]
