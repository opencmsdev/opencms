# OpenCMS, self-hosted profile in a container: Bun + a SQLite file on a
# volume, the admin SPA prebuilt and served from the same origin.
#
#   docker build -t opencms .
#   docker run -p 3000:3000 -v opencms-data:/data \
#     -e BETTER_AUTH_SECRET=$(openssl rand -hex 32) opencms
#
# Media persists when you point OPENCMS_S3_* at any S3-compatible bucket
# (MinIO alongside this container works well); without it uploads live in
# memory and vanish on restart. Set OPENCMS_PG_URL to keep content in
# Postgres instead of SQLite. See docs/DOCKER.md.

FROM oven/bun:1 AS build
WORKDIR /app

# Dependency layer: manifests only, so source edits do not bust the cache.
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts
COPY tsconfig.json ./
RUN bun install --frozen-lockfile
RUN bun run build:admin

FROM oven/bun:1
WORKDIR /app
ENV NODE_ENV=production

# Bun runs the TypeScript sources directly; no compile step exists to copy.
COPY --from=build /app/package.json /app/bun.lock /app/tsconfig.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps ./apps
COPY --from=build /app/scripts ./scripts

# The one writable path: the SQLite database (content + auth).
VOLUME /data
ENV OPENCMS_DB=/data/opencms.db
ENV OPENCMS_PORT=3000
EXPOSE 3000

# BETTER_AUTH_SECRET intentionally has no default: the server refuses to be
# deployed with the well-known dev secret, so pass your own at run time.
CMD ["bun", "run", "apps/dev/index.ts"]
