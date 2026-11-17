# Retired EB4F image qualification

The three one-time OCI build and qualification workflows pinned the reviewed backend source at `eb4f5430bafcb0634c5543057a5441ad499a9870` and the original artifact from GitHub Actions run 39497416295. Their results apply to that artifact. The Node 26 backend uses a separate image and lifecycle. [Original artifact run](https://github.com/eliza-research/thenetwork/actions/runs/39497416295)

The reviewed workflow definitions, helper code, image receipts, and exact grant pins remain in Git at `1e2caa5028ade43ec7cb6a90de16466584f7ead0`.

- `.github/workflows/backend-candidate-artifact.yml`
- `.github/workflows/retained-eb4f-runtime.yml`
- `.github/workflows/network-retained-eb4f-mcpon-v2.yml`
- `.github/runtime-eb4f/`
- `.github/runtime-eb4f-mcpon-v2/`

To inspect the original file bytes, run `git show 1e2caa5028ade43ec7cb6a90de16466584f7ead0:<path>`.
