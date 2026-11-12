FROM docker.io/library/node:24-bookworm-slim AS media-sandbox
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev linux-libc-dev
COPY server/media-sandbox.c /tmp/media-sandbox.c
RUN cc -O2 -Wall -Wextra -Werror /tmp/media-sandbox.c -o /tmp/kakuoku-media-sandbox

FROM docker.io/library/node:24-bookworm-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.mjs ./
COPY src ./src
COPY shared ./shared
COPY public ./public
COPY server/vite-production.mjs server/agentation-disabled.mjs ./server/
RUN npm run build -- --config server/vite-production.mjs

FROM docker.io/library/node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3100 KAKUOKU_PRODUCTION=1
COPY server/requirements-youtube.txt ./server/requirements-youtube.txt
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg \
    && python3 -m venv /opt/kakuoku-youtube \
    && /opt/kakuoku-youtube/bin/pip install --no-cache-dir -r server/requirements-youtube.txt
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && mkdir -m 700 /app/data && chown node:node /app/data
COPY --from=build /app/dist ./dist
RUN chmod -R a+rX /app/dist
COPY server ./server
COPY --from=media-sandbox /tmp/kakuoku-media-sandbox ./server/bin/kakuoku-media-sandbox
COPY shared ./shared
USER 1000:1000
EXPOSE 3100
CMD ["node", "server/index.mjs"]
