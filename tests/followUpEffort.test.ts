import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";

// MUYU-365 gap2: follow-up carries Core's per-turn reasoningEffort only when given; otherwise the body is byte-identical.
let vite: ViteDevServer;
let api: typeof import("../src/addons/conversation/api/conversation.ts");
let unregister: () => void;
const bodies: unknown[] = [];

before(async () => {
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime({ http: { post: async (_url: string, body: unknown) => { bodies.push(body); return { data: { data: { id: 7 } } }; } } });
  api = await vite.ssrLoadModule("/src/addons/conversation/api/conversation.ts") as typeof api;
});
after(async () => { unregister?.(); await vite?.close(); });

test("follow-up adds reasoningEffort only when set", async () => {
  bodies.length = 0;
  await api.followUp(7, "q");
  await api.followUp(7, "q", undefined, undefined, undefined, "high");
  await api.followUp(7, "q", [{ fileId: "f", name: "a.txt" }], undefined, "codex", "low");
  assert.deepEqual(bodies, [
    { input: "q" },
    { input: "q", reasoningEffort: "high" },
    { input: "q", attachments: [{ fileId: "f", name: "a.txt" }], executionBackend: "codex", reasoningEffort: "low" },
  ]);
});
