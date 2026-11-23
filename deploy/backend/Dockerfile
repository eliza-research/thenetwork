# syntax=docker/dockerfile:1.20@sha256:26147acbda4f14c5add9946e2fd2ed543fc402884fd75146bd342a7f6271dc1d
# The shared backend (docs/deploy.md). Build from the repository root:
#   docker build -f deploy/backend/Dockerfile -t network-backend .
# One image serves both services: the backend (default command) and the optional
# staff console (apps/observatory/deploy/worker.ts sets its entrypoint, real mode only).

# Node 26.13.0 matches .nvmrc. Pin the official image to its multi-architecture index.
ARG NODE_IMAGE=node:26.13.0-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68

FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install --global corepack@0.35.0 \
    && corepack pnpm fetch --prod --ignore-scripts
# Link the workspace on manifest changes. Source-only edits can reuse these links.
COPY --parents packages/*/package.json apps/observatory/package.json ./
RUN corepack pnpm install --offline --frozen-lockfile --prod --ignore-scripts

FROM dependencies AS build
# Only what the processes run: the workspaces and the deploy entry (Dockerfile.dockerignore keeps the rest out).
COPY tsconfig.json ./
COPY packages ./packages
COPY apps/observatory ./apps/observatory
COPY deploy ./deploy
COPY tools/vibestack/vibestack/design ./tools/vibestack/vibestack/design
# The fitted relay Clef weights (RELAY_CLEF_WEIGHTS_PATH=evals/relay/clef-relay-weights.json); the corpora stay out.
COPY evals/relay/clef-relay-weights.json ./evals/relay/clef-relay-weights.json
# Build the CSS used in connector responses and in the staff console.
RUN node packages/design-system/build.ts build \
    && node --import tsx packages/mcp/src/pages/build-css.ts \
    && rm -rf tools
# The simulator, the judges, the eval corpora, the synthetic worlds and the Eliza plugin never run here:
# the backend and the real-only console import none of them (pnpm run sim, block ops, checks this line).
RUN rm -rf packages/sim packages/judge packages/evals packages/worlds packages/plugin-network

FROM ${NODE_IMAGE}
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node --exclude=node_modules /app /app
USER node
ENV PORT=8790 STAFF_PORT=4848
EXPOSE 8790 4848
# Railway uses healthcheckPath in railway.toml; this is for docker and podman runs.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8790)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
STOPSIGNAL SIGTERM
# Exec form gives the Node process SIGTERM for graceful shutdown in server.ts.
CMD ["node", "--import", "tsx", "deploy/backend/server.ts"]
