# Cloudflare backend

This Worker hosts the existing backend Dockerfile. PostgreSQL remains on Railway.
The public listener is port 8790. The staff listener is not routed by this Worker.
The backend still checks signed Pages headers, service signatures, tenant scope,
and database grants. A minute cron keeps its persisted job scheduler running.

Use `scripts/wrangler.sh` with the approved account and `--env staging` or
`--env production`. The checked-in configuration is inactive. Requests return 503
and the cron does nothing until `BACKEND_ENABLED=true` is supplied at deployment.

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
6. Retire the old Railway backend after the checks pass. Keep PostgreSQL.

For rollback, deactivate the Cloudflare deployment and drain its work before
restarting the old backend. Restore the previous Pages origin. Never activate
both deployments with uncoordinated ownership of outbound work.
