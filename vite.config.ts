import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// 端口、后端地址、跨域目标全部可通过环境变量配置（.env 或 shell）：
//   CORE_WEB_PORT (默认 26688)        — dev server 端口
//   CORE_WEB_HOST (默认 0.0.0.0)      — WSL/容器外的 shell 可访问
//   CORE_BACKEND_URL (默认 http://localhost:26680) — /api 代理目标（core 后端）
// 支持微前端：作为 micro-app 子应用运行时，端口由壳应用编排注入。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const port = Number(env.CORE_WEB_PORT ?? env.PORT ?? 26688);
  const host = env.CORE_WEB_HOST ?? "0.0.0.0";
  const backendUrl = env.CORE_BACKEND_URL ?? "http://localhost:26680";

  return {
    // React only for the MUYU-365 chat island; every .vue file stays on plugin-vue.
    plugins: [vue(), react({ include: /src\/chat-react\/.*\.tsx$/ }), {
      // MUYU-365 exp86c: aui's message conversion is the island's one user of assistant-stream/utils; every island
      // tool-call part carries `args`, so it never repairs partial JSON (tests/auiSessionStubs.test.ts pins this).
      name: "aui-partial-json-stand-in", enforce: "pre",
      resolveId: (id, importer) => id === "assistant-stream/utils" && importer?.endsWith("/@assistant-ui/core/dist/runtime/utils/thread-message-like.js")
        ? resolve(process.cwd(), "src/vendor/assistant-ui-core/assistant-stream-utils.ts") : null,
    }, {
      // MUYU-365 exp107: the island registers no model-context provider, so the thread runtime never has composer metadata
      // or interactables to gate (tests/auiSessionStubs.test.ts pins this). Scoped to that one importer.
      name: "aui-interactable-gate-stand-in", enforce: "pre",
      resolveId: (id, importer) => id === "../../model-context/interactable-composer-metadata.js" && importer?.endsWith("/@assistant-ui/core/dist/runtime/base/base-thread-runtime-core.js")
        ? resolve(process.cwd(), "src/vendor/assistant-ui-core/interactable-composer-metadata.ts") : null,
    }, {
      // MUYU-365 exp107: no runtime-adapters provider, so useExternalStoreRuntime never copies history (auiSessionStubs pins it).
      name: "aui-history-copy-stand-in", enforce: "pre",
      resolveId: (id, importer) => id === "./external-store-history-copy.js" && importer?.endsWith("/@assistant-ui/core/dist/react/runtimes/useExternalStoreRuntime.js")
        ? resolve(process.cwd(), "src/vendor/assistant-ui-core/external-store-history-copy.ts") : null,
    }, {
      // MUYU-365 exp109: the island never sets turnAnchor="top", so the viewport and message root never reach top-anchor code.
      name: "aui-top-anchor-stand-in", enforce: "pre",
      resolveId: (id, importer) => ((id === "./topAnchor/useTopAnchorReserve.js" || id === "./topAnchor/topAnchorTurn.js") && importer?.endsWith("/@assistant-ui/react/dist/primitives/thread/ThreadViewport.js"))
        || (id === "../thread/topAnchor/topAnchorUtils.js" && importer?.endsWith("/@assistant-ui/react/dist/primitives/message/MessageRoot.js"))
        ? resolve(process.cwd(), "src/vendor/assistant-ui-core/top-anchor.ts") : null,
    }],
    resolve: {
      dedupe: ["vue", "vue-router"],
      preserveSymlinks: true,
      alias: {
        "@prism-fusion/plugin-runtime/remote": resolve(
          process.cwd(),
          "src/vendor/prism-fusion-plugin-runtime/remote.ts",
        ),
        "@prism-fusion/plugin-runtime/types": resolve(
          process.cwd(),
          "src/vendor/prism-fusion-plugin-runtime/types.ts",
        ),
        "@prism-fusion/plugin-runtime": resolve(
          process.cwd(),
          "src/vendor/prism-fusion-plugin-runtime/headless.ts",
        ),
        // MUYU-365: per-file aui primitives; the package's `XPrimitive` namespaces are not tree-shakable
        // (getter-based export objects pull every member). Valid for the exactly pinned 0.15.36 only.
        "@aui-dist": resolve(process.cwd(), "node_modules/@assistant-ui/react/dist"),
        // MUYU-408: the island passes no voice/dictation adapter; these two @assistant-ui/core 0.3.35 session controllers
        // are unreachable, so the bundle gets inert stand-ins (tests/auiSessionStubs.test.ts pins the contract).
        "./voice-session.js": resolve(process.cwd(), "src/vendor/assistant-ui-core/voice-session.ts"),
        "./dictation-session.js": resolve(process.cwd(), "src/vendor/assistant-ui-core/dictation-session.ts"),
        // MUYU-365 batch 2: the island never sets unstable_enableToolInvocations, so the tracker is never constructed.
        "../tool-invocations/ToolInvocationTracker.js": resolve(process.cwd(), "src/vendor/assistant-ui-core/tool-invocation-tracker.ts"),
        // MUYU-365 exp104: island tool-call parts never carry `approval`; both library call sites are behind that check.
        "../utils/resolveToolApprovalResponse.js": resolve(process.cwd(), "src/vendor/assistant-ui-core/resolve-tool-approval.ts"),
        "../../runtime/utils/resolveToolApprovalResponse.js": resolve(process.cwd(), "src/vendor/assistant-ui-core/resolve-tool-approval.ts"),
        "@": resolve(process.cwd(), "src"),
      },
    },
    // Folds sub-500 B shared chunks back so the React island's split does not add per-chunk gzip
    // overhead to the default (Vue) /chat and /c/:id paths (MUYU-365 plan §9: ≤ 1 KiB delta).
    build: {
      minify: "terser",
      terserOptions: { ecma: 2020, compress: { passes: 2 } },
      rollupOptions: { output: {
        experimentalMinChunkSize: 500,
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          if (/\/src\/chat-react\/islandStrings(En|Zh)\.ts$/.test(id)) return "chat-strings";
        },
      } },
    },
    server: {
      host,
      port,
      // micro-app 子应用需要被壳应用 fetch 跨域加载，允许跨域。
      cors: true,
      proxy: {
        "/api": {
          target: backendUrl,
          changeOrigin: true,
        },
      },
    },
  };
});
