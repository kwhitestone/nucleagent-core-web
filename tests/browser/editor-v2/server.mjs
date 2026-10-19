import { createServer } from "vite";

const server = await createServer({
  optimizeDeps: { entries: ["tests/browser/editor-v2/index.html"] },
  server: { host: "127.0.0.1", port: 5471, strictPort: true },
});
await server.listen();
server.printUrls();
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => {
  await server.close();
  process.exit(0);
});
