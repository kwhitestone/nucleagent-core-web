import { createServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const server = await createServer({
  root, configFile: false, envFile: false, plugins: [vue()],
  resolve: { alias: {
    "shell-auth-intent": resolve(process.env.SHELL_ROOT ?? resolve(root, "../shell"), "src/runtime/remoteIntents.ts"),
    "@prism-fusion/plugin-runtime/remote": resolve(root, "src/vendor/prism-fusion-plugin-runtime/remote.ts"),
    "@": resolve(root, "src"),
  } },
  optimizeDeps: { entries: ["tests/browser/session-renewal/child.html"] },
  server: { host: "127.0.0.1", port: Number(process.env.PORT ?? 5198), strictPort: true, hmr: false,
    fs: { allow: [root, resolve(process.env.SHELL_ROOT ?? resolve(root, "../shell"))] } },
});
await server.listen();
console.log(`Synthetic fixture: http://127.0.0.1:${server.config.server.port}/tests/browser/session-renewal/`);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => {
  await server.close();
  process.exit(0);
});
