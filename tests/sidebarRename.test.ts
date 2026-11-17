import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { createPinia, setActivePinia } from "pinia";

// MUYU-410: shell sidebar 「⋯ › 重命名」 → bridge `rename` → Core PATCH {title} through the real store/api; answer `rename-result`.
let vite: ViteDevServer;
let mod: typeof import("../src/addons/conversation/composables/sidebarRename.ts");
let useStore: typeof import("../src/addons/conversation/store/conversation.ts").useConversationStore;
let unregister: () => void;
let patches: Array<[string, unknown]>;
let reply: (path: string, body: { title: string }) => unknown;

before(async () => {
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime({
    http: { patch: async (path: string, body: { title: string }) => { patches.push([path, body]); return reply(path, body); } },
    getAccessToken: () => "t", getSessionVersion: () => 3,
  });
  mod = await vite.ssrLoadModule("/src/addons/conversation/composables/sidebarRename.ts") as typeof mod;
  useStore = (await vite.ssrLoadModule("/src/addons/conversation/store/conversation.ts")).useConversationStore;
});
after(async () => { unregister(); await vite.close(); });
beforeEach(() => {
  patches = [];
  reply = (_p, body) => ({ data: { code: 0, data: { id: 7, title: body.title.trim() } } });
  setActivePinia(createPinia());
});

const intent = (extra = {}) => ({ source: "shell", type: "rename", requestId: 4, conversationId: 7, title: "季度报告", ...extra });

test("parser accepts only a well-formed shell rename with a 1-80 rune trimmed title", () => {
  assert.deepEqual(mod.parseRenameIntent(intent({ title: "  季度报告 " })), { requestId: 4, conversationId: 7, title: "季度报告" });
  assert.equal(mod.parseRenameIntent(intent({ title: "字".repeat(80) }))?.title.length, 80);
  for (const bad of [
    intent({ source: "sub" }), intent({ type: "delete" }), intent({ conversationId: 0 }), intent({ conversationId: "7" }),
    intent({ requestId: -1 }), intent({ title: "   " }), intent({ title: "字".repeat(81) }), intent({ title: 5 }), null,
  ]) assert.equal(mod.parseRenameIntent(bad), null);
});

test("success PATCHes through the store, updates the row and answers with Core's title", async () => {
  const store = useStore();
  store.conversations = [{ id: 7, title: "old" }, { id: 8, title: "other" }] as never;
  const sent: unknown[] = [];
  await mod.runSidebarRename(mod.parseRenameIntent(intent())!, store.rename, (p) => sent.push(p), () => assert.fail("no toast"));
  assert.deepEqual(patches, [["/api/v1/addons/conversation/7", { title: "季度报告" }]]);
  assert.deepEqual(store.conversations.map((c) => c.title), ["季度报告", "other"]);
  assert.deepEqual(sent, [{ source: "sub", type: "rename-result", requestId: 4, conversationId: 7, ok: true, title: "季度报告" }]);
});

test("failure (e.g. 404 for someone else's conversation) keeps the row, toasts once and answers ok:false", async () => {
  reply = () => { throw Object.assign(new Error("nf"), { status: 404 }); };
  const store = useStore();
  store.conversations = [{ id: 7, title: "old" }] as never;
  const sent: unknown[] = [];
  let toasts = 0;
  await mod.runSidebarRename(mod.parseRenameIntent(intent())!, store.rename, (p) => sent.push(p), () => { toasts += 1; });
  assert.equal(store.conversations[0].title, "old");
  assert.equal(toasts, 1);
  assert.deepEqual(sent, [{ source: "sub", type: "rename-result", requestId: 4, conversationId: 7, ok: false }]);
});
