# Container rebuilds after a source edit

Both production images install packages from the same lockfile. The backend used to publish the entire application and all dependencies in one layer. The backup build used all workspaces as inputs even though the final image uses only the core package.

The two Dockerfiles now copy workspace manifests with their paths before they run the offline install. The backup context includes the manifests, core and the backup entry points. The backend publishes its installed root dependencies in a separate layer. The build uses the pinned multi-architecture Dockerfile 1.20 frontend.

| Build after an edit to core source | Previous wall seconds | Revised wall seconds |
| --- | ---: | ---: |
| Backend | 8.87 | 3.45 |
| Backup | 7.50 | 1.71 |

Times are medians of three paired runs after warm-up on Docker Desktop 29.7.2 (Linux ARM64). Each pair used the same new comment in `packages/core/src/guard.ts`. Build order alternated. The command was `docker build --progress=plain -f deploy/<target>/Dockerfile -t <local-tag> .` from a clean export of `9bfc456c`. The backend samples were 8.72, 8.87 and 10.25 seconds before, and 3.45, 3.30 and 3.61 seconds after. Backup samples were 7.50, 7.16 and 7.57 before, and 1.71, 1.79 and 1.46 after. These are local warm-builder measurements. A fresh builder needs the 12.66 MB ARM64 frontend once. Network registry transfer and hosted billing were not measured.

Docker reused the 161 MB backend dependencies layer across source edits. The changing layer went from 176 MB to 14.1 MB (uncompressed Docker history sizes). Each backup source edit also reused the offline install. Changing the core package manifest caused the install to run again and updated the manifest in the image.

The old and revised backend started with their normal command, applied migrations to separate empty Postgres databases in an isolated Docker network, and returned HTTP 200 at `/healthz`. All file contents and symlink targets under `/app` were compared (10,372 backend and 9,545 backup entries per image). The only content differences were the edited Docker build files and pnpm's validation timestamp. The full image configurations matched for each pair. Both backup images imported the backup and restore entry points and ran the PostgreSQL 16.16 tools with networking disabled. All six repository Postgres backup integration tests passed.
