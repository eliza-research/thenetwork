# syntax=docker/dockerfile:1.20@sha256:26147acbda4f14c5add9946e2fd2ed543fc402884fd75146bd342a7f6271dc1d
# The backup job (docs/deploy.md section 8): pg_dump, pg_dumpall and pg_restore of the server's major
# version, plus Node for deploy/backup/*.ts. Build from the repository root:
#   docker build -f deploy/backup/Dockerfile --build-arg PG_MAJOR=16 -t network-backup .
# PG_MAJOR must be the Railway Postgres major version or newer (select version(); pg_dump refuses a newer server).
# Pin the Postgres tag to the target server version when selecting the backup image.
ARG PG_MAJOR=16
ARG NODE_IMAGE=node:26.13.0-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68

FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install --global corepack@0.35.0 \
    && corepack pnpm fetch --prod --ignore-scripts
# Link the workspace on manifest changes. Source-only edits can reuse these links.
COPY --parents packages/*/package.json ./
RUN corepack pnpm install --offline --frozen-lockfile --prod --ignore-scripts
COPY tsconfig.json ./
COPY packages/core ./packages/core

FROM postgres:${PG_MAJOR}-bookworm
ARG PG_MAJOR
# Node 26's Linux binary needs libatomic on Bookworm.
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=dependencies /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=dependencies --chown=postgres:postgres /app/package.json /app/tsconfig.json ./
COPY --from=dependencies --chown=postgres:postgres /app/node_modules ./node_modules
COPY --from=dependencies --chown=postgres:postgres /app/packages/core ./packages/core
COPY --chown=postgres:postgres deploy/backup ./deploy/backup
# Never root; the postgres user ships with the image and never runs a server here.
USER postgres
ENV PG_BIN_DIR=/usr/lib/postgresql/${PG_MAJOR}/bin
ENTRYPOINT []
CMD ["node", "--import", "tsx", "deploy/backup/backup.ts"]
