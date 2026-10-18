import { createServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";
const root = resolve(process.env.CORE_WEB_ROOT ?? "."), shell = resolve(process.env.SHELL_ROOT ?? "../shell");
const backend = process.env.BACKEND_ORIGIN;
if (backend && !/^http:\/\/127\.0\.0\.1:\d+$/.test(backend)) throw Error("Only isolated loopback backend allowed");
const server = await createServer({
  root, configFile: false, envFile: false, plugins: [vue()],
  resolve: { dedupe: ["vue", "pinia", "vue-router", "vue-i18n"], alias: [
    { find: "binding-store", replacement: resolve(shell, "src/addons/shell-session/store/session.ts") },
    { find: "binding-contract", replacement: resolve(shell, "src/contracts/shell-session.ts") },
    { find: "binding-producer", replacement: resolve(shell, "src/runtime/remoteSession.ts") },
    { find: "binding-lifecycle", replacement: resolve(shell, "src/addons/shell-session/index.ts") },
    { find: /^@\//, replacement: "", customResolver(source, importer) {
      return this.resolve(resolve(importer?.startsWith(shell) ? shell : root, "src", source), importer, { skipSelf: true });
    } },
    { find: "@prism-fusion/plugin-runtime/remote", replacement: resolve(root, "src/vendor/prism-fusion-plugin-runtime/remote.ts") },
  ] },
  cacheDir: resolve(`.binding-cache-${process.env.PORT ?? 5301}`),
  optimizeDeps: { entries: ["tests/browser/integrated/independent.html", "tests/browser/integrated/independent-child.html"],
    include: ["vue", "pinia", "vue-router", "vue-i18n", "axios", "@lucide/vue", "zod"] },
  server: { host: "127.0.0.1", port: Number(process.env.PORT ?? 5301), strictPort: true, hmr: false,
    fs: { allow: [root, shell] }, proxy: backend ? { "/__fixture": backend, "/api": backend } : undefined },
});
await server.listen();
console.log(`Synthetic store/frame fixture listening on ${server.config.server.port}`);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => {
  await server.close(); process.exit(0);
});
