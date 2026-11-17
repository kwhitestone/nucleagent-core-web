import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { createPinia, setActivePinia } from "pinia";

// MUYU-410: shell sidebar 「⋯ › 置顶/取消置顶」 → bridge `pin` → Core PATCH {pinned} through the real store/api;
// answer `pin-result`; the sidebar projection carries `pinned` so the shell can group a pinned section.
let vite: ViteDevServer;
let mod: typeof import("../src/addons/conversation/composables/sidebarPin.ts");
let projection: typeof import("../src/addons/conversation/composables/sidebarProjection.ts");
let useStore: typeof import("../src/addons/conversation/store/conversation.ts").useConversationStore;
let unregister: () => void;
let patches: Array<[string, unknown]>;
let reply: (path: string, body: { pinned: boolean }) => unknown;

before(async () => {
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime({
    http: { patch: async (path: string, body: { pinned: boolean }) => { patches.push([path, body]); return reply(path, body); } },
    getAccessToken: () => "t", getSessionVersion: () => 3,
  });
  mod = await vite.ssrLoadModule("/src/addons/conversation/composables/sidebarPin.ts") as typeof mod;
  projection = await vite.ssrLoadModule("/src/addons/conversation/composables/sidebarProjection.ts") as typeof projection;
  useStore = (await vite.ssrLoadModule("/src/addons/conversation/store/conversation.ts")).useConversationStore;
});
after(async () => { unregister(); await vite.close(); });
beforeEach(() => {
  patches = [];
  reply = (_p, body) => ({ data: { code: 0, data: { id: 7, title: "a", pinned: body.pinned, pinnedAt: body.pinned ? "2026-11-17T22:00:00+08:00" : null } } });
  setActivePinia(createPinia());
});

const intent = (extra = {}) => ({ source: "shell", type: "pin", requestId: 4, conversationId: 7, pinned: true, ...extra });

test("parser accepts only a well-formed shell pin intent with a boolean", () => {
  assert.deepEqual(mod.parsePinIntent(intent()), { requestId: 4, conversationId: 7, pinned: true });
  assert.deepEqual(mod.parsePinIntent(intent({ pinned: false })), { requestId: 4, conversationId: 7, pinned: false });
  for (const bad of [
    intent({ source: "sub" }), intent({ type: "rename" }), intent({ conversationId: 0 }), intent({ conversationId: "7" }),
    intent({ requestId: -1 }), intent({ pinned: "true" }), intent({ pinned: 1 }), intent({ pinned: undefined }), null, "pin",
  ]) assert.equal(mod.parsePinIntent(bad), null);
});

test("pin PATCHes {pinned} through the store, flags only that row and answers with Core's state", async () => {
  const store = useStore();
  store.conversations = [{ id: 7, title: "a" }, { id: 8, title: "b" }] as never;
  const orderBefore = store.sorted.map((c) => c.id);
  const sent: unknown[] = [];
  await mod.runSidebarPin(mod.parsePinIntent(intent())!, store.setPinned, (p) => sent.push(p), () => assert.fail("no toast"));
  assert.deepEqual(patches, [["/api/v1/addons/conversation/7", { pinned: true }]]);
  assert.deepEqual(store.conversations.map((c) => [c.id, c.pinned ?? false]), [[7, true], [8, false]]);
  assert.deepEqual(sent, [{ source: "sub", type: "pin-result", requestId: 4, conversationId: 7, ok: true, pinned: true }]);

  await mod.runSidebarPin(mod.parsePinIntent(intent({ requestId: 5, pinned: false }))!, store.setPinned, (p) => sent.push(p), () => assert.fail("no toast"));
  assert.deepEqual(patches[1], ["/api/v1/addons/conversation/7", { pinned: false }]);
  assert.equal(store.conversations[0].pinned, false);
  assert.equal(store.conversations[0].pinnedAt, null);
  assert.deepEqual(sent[1], { source: "sub", type: "pin-result", requestId: 5, conversationId: 7, ok: true, pinned: false });
  // order is untouched: the shell groups, the store does not reorder.
  assert.deepEqual(store.sorted.map((c) => c.id), orderBefore);
});

test("failure (e.g. 404 for someone else's conversation) keeps the row, toasts once and answers ok:false", async () => {
  reply = () => { throw Object.assign(new Error("nf"), { status: 404 }); };
  const store = useStore();
  store.conversations = [{ id: 7, title: "a", pinned: false }] as never;
  const sent: unknown[] = [];
  let toasts = 0;
  await mod.runSidebarPin(mod.parsePinIntent(intent())!, store.setPinned, (p) => sent.push(p), () => { toasts += 1; });
  assert.equal(store.conversations[0].pinned, false);
  assert.equal(toasts, 1);
  assert.deepEqual(sent, [{ source: "sub", type: "pin-result", requestId: 4, conversationId: 7, ok: false }]);
});

test("sidebar projection adds pinned (false for old Core rows without the field) and keeps the old keys", () => {
  const row = { id: 7, title: "a", status: "completed", executionBackend: "hermes", state: { broadcastGroupId: "0b3f5e2a-1c4d-4e8f-9a6b-2d7c8e9f0a1b" } };
  assert.deepEqual(projection.sidebarRow(row as never),
    { id: 7, title: "a", status: "completed", broadcastGroupId: "0b3f5e2a-1c4d-4e8f-9a6b-2d7c8e9f0a1b", executionBackend: "hermes", pinned: false });
  assert.equal(projection.sidebarRow({ ...row, pinned: true } as never).pinned, true);
});
