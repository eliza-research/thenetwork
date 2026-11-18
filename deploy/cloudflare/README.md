# Cloudflare backend

This Worker hosts the existing backend Dockerfile. PostgreSQL remains on Railway.
The public listener is port 8790. The backend still checks signed Pages headers,
service signatures, tenant scope, and database grants.

**This path cannot be activated yet.** The staff API (`STAFF_PORT`, 4848: review,
safety, leak review, phone holds) is served only inside the container, and this
Worker routes nothing to it. The console reaches the staff API at
`NETWORK_SERVICE_URL`, which today is `http://backend.railway.internal:4848` on
Railway's private network. After a cutover nobody could approve a review, so every
proposal would expire unsent, and no hold, ban, relay release or leak decision
could be made (audit OPS28). Until a private staff route is built and tested, the
Worker refuses `BACKEND_ENABLED=true`: each request answers 503
`staff_api_unreachable`, the cron fails with the same reason, and both stop any
running container. Keep the Railway backend as the deployment.

Choosing the staff route is an operator and founder decision. Two designs fit the
existing checks:

1. A dedicated staff hostname on this Worker, behind a Cloudflare Access
   application, that forwards to port 4848 (`switchPort`) only after the Worker
   verifies the Access JWT (audience and issuer). The console then sends an Access
   service token with each staff call.
2. The console in the same container or private network as the backend, so the
   staff port is never exposed to the Internet.

Either one needs its own integration case that a review decision and a safety
hold reach the staff API through the route, and the Postgres exposure below must
be decided with it (docs/deploy.md asks not to enable Postgres's public TCP proxy).

Use `scripts/wrangler.sh` with the approved account and `--env staging` or
`--env production`. The checked-in configuration is inactive. Requests return 503
and neither requests nor cron start it until `BACKEND_ENABLED=true` is supplied
at deployment.

1. Build and verify the source commit. Run the repository integration, e2e,
   simulation, and type checks. Build the image with `deploy --dry-run`.
2. Preserve the old deployment configuration and database backup. Make PostgreSQL
   reachable from Cloudflare. Preserve the restricted service login, database
   name, and credentials when changing connection hosts. Never use the migration
   owner as the service login.
3. Store the runtime's string-valued settings as the `BACKEND_RUNTIME_CONFIG`
   Worker secret. Its `PLATFORM_ENV` must match the deployment. Railway-private
   database addresses are rejected. Preserve all send and matching approvals.
4. Stop the old backend and drain its work before activating the replacement.
   Deploy with `--var BUILD_ID:<full-source-commit>` and
   `--var BACKEND_ENABLED:true`. Every future active deploy needs these options.
5. Verify `/healthz`, the served build header, signed site requests, OAuth
   discovery, and signed service routing. Switch the Pages backend origin only
   after these checks. Verify all four sites and their environment separation.
6. Verify a review decision and a safety hold through the staff route from the
   console. Retire the old Railway backend only after the checks pass. Keep
   PostgreSQL.

For rollback, deactivate the Cloudflare deployment. Its next request or cron sends
SIGTERM when runtime credentials are present. Verify the container is stopped
with `wrangler containers instances <application-id>` before
restarting the old backend. Restore the previous Pages origin. Never activate
both deployments with uncoordinated ownership of outbound work.
