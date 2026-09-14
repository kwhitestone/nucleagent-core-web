import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";

let vite: ViteDevServer;
let unregister: () => void;
let newStore: () => any;
let navigation: any;
let token = "test-account";
let post: (path: string, body: unknown) => Promise<unknown>;
let get: (path: string, config: any) => Promise<unknown>;
const groupId = "371879a2-c7a5-43b5-92a3-3e9dc30c0989";
const payload = { mode: "a2a_agent", input: "compare", attachments: [{ fileId: "file-1" }] };
const conversations = [41, 42].map((id) => ({
  id, title: "compare", status: "executing", mode: "a2a_agent", userId: 1,
  state: { broadcastGroupId: groupId }, createdAt: "2026-09-09T00:00:00Z", updatedAt: "2026-09-09T00:00:00Z",
}));
const result = { groupId, conversations, skipped: [{ backend: "gemini-cli", reason: "offline" }] };

before(async () => {
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime({
    http: {
      post: (path: string, body: unknown) => post(path, body),
      get: (path: string, config: any) => get(path, config),
    },
    getAccessToken: () => token, getSessionVersion: () => 1,
  });
  const { createPinia } = await vite.ssrLoadModule("pinia");
  const { useConversationStore } = await vite.ssrLoadModule("/src/addons/conversation/store/conversation.ts");
  newStore = () => useConversationStore(createPinia());
  ({ conversationNavigation: navigation } = await vite.ssrLoadModule("/src/addons/conversation/composables/conversationNavigation.ts"));
});
after(async () => { unregister?.(); await vite?.close(); });

test("broadcast creation inserts all siblings, seeds previews and retains skip reasons", async () => {
  const store = newStore();
  post = async (path, body) => {
    assert.equal(path, "/api/v1/addons/conversation/broadcast");
    assert.deepEqual(body, payload);
    return { data: { code: 0, data: result } };
  };
  const created = await store.createBroadcast(payload);
  assert.equal(created.groupId, groupId);
  assert.deepEqual(store.conversations.map((item: any) => item.id), [41, 42]);
  assert.deepEqual(store.broadcastNotices[groupId], result.skipped);
  for (const id of [41, 42]) {
    assert.equal(navigation.forConversation(String(id)).read().items[0].content, "compare");
  }
  store.reset();
  assert.deepEqual(store.broadcastNotices, {});
});

test("account switch discards a late broadcast creation and its previews", async () => {
  const store = newStore();
  let resolve!: (value: unknown) => void;
  post = () => new Promise(done => { resolve = done; });
  const creating = store.createBroadcast(payload);
  store.reset();
  token = "next-account";
  resolve({ data: { code: 0, data: result } });
  await assert.rejects(creating, { name: "AbortError" });
  assert.deepEqual(store.conversations, []);
  assert.deepEqual(store.broadcastNotices, {});
});

test("hydrating or removing old group members never advances the history cursor", async () => {
  const store = newStore();
  const page = Array.from({ length: 20 }, (_, i) => ({ ...conversations[0], id: 100 - i, state: {} }));
  const requests: unknown[] = [];
  get = async (_path, config) => {
    requests.push(config.params.beforeId);
    return { data: { code: 0, data: requests.length === 1 ? page : [{ ...page[0], id: 80 }], hasMore: true } };
  };
  await store.load();
  store.upsert({ ...conversations[0], id: 10 });
  store.upsert({ ...conversations[1], id: 11 });
  store.reconcileBroadcastMembers(groupId, [11]);
  await store.loadMore();
  assert.deepEqual(requests, [undefined, 81]);
  assert.equal(store.conversations.some((item: any) => item.id === 80), true);
  assert.equal(store.conversations.some((item: any) => item.id === 10), false);
  assert.equal(store.conversations.some((item: any) => item.id === 11), true);
});

test("authoritative group removal retires only its own rows and cached previews", () => {
  const store = newStore();
  for (const row of conversations) {
    store.upsert(row);
    navigation.forConversation(String(row.id)).write({ status: "idle", hasOlder: false, items: [] });
  }
  store.upsert({ ...conversations[0], id: 70, state: {} });
  store.reconcileBroadcastMembers(groupId, []);
  assert.deepEqual(store.conversations.map((row: any) => row.id), [70]);
  assert.equal(navigation.forConversation("41").read(), undefined);
  assert.equal(navigation.forConversation("42").read(), undefined);
});
