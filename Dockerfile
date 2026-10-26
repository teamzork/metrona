# Metrona in a container: one image, every command.
#
#   docker run --rm -p 3003:3003 ghcr.io/teamzork/metrona demo
#   docker compose up -d        # with compose.example.yaml: the scheduler and the dashboard
#
# It needs no network and no database: mount the web server's logs read-only and keep
# /var/lib/metrona in a volume.
FROM node:22-slim

ENV NODE_ENV=production \
    TZ=UTC \
    METRONA_DEMO_HOST=0.0.0.0

WORKDIR /opt/metrona
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force \
 && ln -s /opt/metrona/packages/cli/src/index.js /usr/local/bin/metrona \
 && metrona --version \
 # A new named volume takes this owner, so the scheduler (uid 1000) can write it.
 && mkdir -p /var/lib/metrona/datasets /var/lib/metrona/dashboard /etc/metrona \
 && chown -R node:node /var/lib/metrona

USER node
VOLUME ["/var/lib/metrona"]
EXPOSE 3001 3003
ENTRYPOINT ["metrona"]
CMD ["--help"]
