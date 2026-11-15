// spec/server.md, "Story: Change the list over HTTP"
// Start the backend: `npm start`, then open http://localhost:3000 in two windows.
import { createServer } from "./server.ts";

const port = Number(process.env.PORT ?? 3000);
createServer().listen(port, () => console.log(`shared to-do list on http://localhost:${port}`));
