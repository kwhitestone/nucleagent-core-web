import { createServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const shell = resolve(process.env.SHELL_ROOT ?? resolve(root, "../shell"));
const server = await createServer({
  root, configFile: false, envFile: false, plugins: [vue()],
  resolve: { dedupe: ["vue", "pinia", "vue-router", "vue-i18n"], alias: [
    { find: "binding-store", replacement: resolve(shell, "src/addons/shell-session/store/session.ts") },
    { find: "binding-producer", replacement: resolve(shell, "src/runtime/remoteSession.ts") },
    { find: "binding-lifecycle", replacement: resolve(shell, "src/addons/shell-session/index.ts") },
    { find: /^@\//, replacement: "", customResolver(source, importer) {
      return this.resolve(resolve(importer?.startsWith(shell) ? shell : root, "src", source), importer, { skipSelf: true });
    } },
    { find: "@prism-fusion/plugin-runtime/remote", replacement: resolve(root, "src/vendor/prism-fusion-plugin-runtime/remote.ts") },
  ] },
  cacheDir: resolve(root, `node_modules/.cross-tab-cache-${process.env.PORT ?? 5301}`),
  optimizeDeps: { entries: ["tests/browser/session-renewal/independent.html", "tests/browser/session-renewal/independent-child.html"],
    include: ["vue", "pinia", "vue-router", "vue-i18n", "axios", "@lucide/vue", "zod"] },
  server: { host: "127.0.0.1", port: Number(process.env.PORT ?? 5301), strictPort: true, hmr: false,
    fs: { allow: [root, shell] } },
});
await server.listen();
console.log(`Synthetic store/frame fixture listening on ${server.config.server.port}`);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => {
  await server.close();
  process.exit(0);
});
