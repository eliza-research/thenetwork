# The backup job (docs/deploy.md section 8): pg_dump, pg_dumpall and pg_restore of the server's major
# version, plus Bun for deploy/backup/*.ts. Build from the repository root:
#   docker build -f deploy/backup/Dockerfile --build-arg PG_MAJOR=16 -t network-backup .
# PG_MAJOR must be the Railway Postgres major version or newer (select version(); pg_dump refuses a newer server).
# Pin both images by digest at the first build (docker buildx imagetools inspect <image>), as deploy/backend/Dockerfile does.
ARG PG_MAJOR=16
ARG BUN_IMAGE=oven/bun:1.4.2-slim@sha256:cb3bbbb08e13a4a2ff400f24c7a2a1d5efa83f6ef8544d52d95a519631e2fc61

FROM ${BUN_IMAGE} AS bun

FROM postgres:${PG_MAJOR}-bookworm
ARG PG_MAJOR
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
# Only the scripts: they import nothing but Bun and each other.
COPY deploy/backup ./deploy/backup
# Never root; the postgres user ships with the image and never runs a server here.
USER postgres
ENV PG_BIN_DIR=/usr/lib/postgresql/${PG_MAJOR}/bin
ENTRYPOINT []
CMD ["bun", "run", "deploy/backup/backup.ts"]
