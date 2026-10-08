# The shared backend (docs/deploy.md). Build from the repository root:
#   docker build -f deploy/backend/Dockerfile -t network-backend .
# One image serves both Railway services: the backend (default command) and the optional
# observatory console (deploy/backend/observatory.railway.toml overrides the start command).

# Bun 1.4.2 (the version the repo is tested with), Debian slim, pinned by its multi-arch index digest.
# To update: look up the new tag's digest on Docker Hub (oven/bun), change both lines together, rebuild, rerun the smoke in docs/deploy.md.
ARG BUN_IMAGE=oven/bun:1.4.2-slim@sha256:cb3bbbb08e13a4a2ff400f24c7a2a1d5efa83f6ef8544d52d95a519631e2fc61

FROM ${BUN_IMAGE} AS build
WORKDIR /app
# Only what the processes run: the workspaces, the lockfile and the deploy entry (Dockerfile.dockerignore keeps the rest out).
COPY package.json bun.lock tsconfig.json ./
COPY packages ./packages
COPY prototypes ./prototypes
COPY deploy ./deploy
# The runtime has no npm dependencies of its own: this links the workspaces. No lifecycle scripts run.
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM ${BUN_IMAGE}
WORKDIR /app
COPY --from=build --chown=bun:bun /app /app
# Never root. The bun user (uid 1000) ships with the base image.
USER bun
ENV PORT=8790 STAFF_PORT=4848
EXPOSE 8790 4848
# Railway uses healthcheckPath in railway.toml; this is for docker and podman runs.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8790)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
STOPSIGNAL SIGTERM
# Exec form: bun is PID 1 and gets SIGTERM itself (graceful shutdown in server.ts).
CMD ["bun", "run", "deploy/backend/server.ts"]
