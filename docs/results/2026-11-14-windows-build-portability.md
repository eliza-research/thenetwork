# Windows checkout and build portability

On November 14, 2026, the site build failed on a scratch checkout
whose four skill files used CRLF. The same build with source line
endings normalized passed 79 site tests. The LF checkout and the
Wrangler wrapper passed 80 tests. On both checkouts, the four built
skills and their four catalog indexes were byte-identical.

The path assertion uses the native path format. The wrapper test
locates Bash on PATH and calls a recorder in a temporary directory.
It reads no operator configuration and contacts no external service.
The before and after checks ran on macOS, with Windows source bytes
in the CRLF fixture. No model or agent client was involved.
