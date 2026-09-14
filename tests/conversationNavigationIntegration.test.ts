import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";

let vite: ViteDevServer;
let unregister: () => void;
let api: any;
let adapterFor: (id: () => string) => any;
let navigation: any;
let seed: any;
let token = "test-account";
let get: (path: string, options?: any) => Promise<any>;

before(async () => {
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime({
    http: { get: (path: string, options: any) => get(path, options) },
    getAccessToken: () => token, getSessionVersion: () => 1,
  });
  api = await vite.ssrLoadModule("/src/addons/conversation/api/conversation.ts");
  ({ createConversationAdapter: adapterFor } = await vite.ssrLoadModule("/src/addons/conversation/composables/useConversationAdapter.ts"));
  ({ conversationNavigation: navigation, seedCreatedConversation: seed } = await vite.ssrLoadModule("/src/addons/conversation/composables/conversationNavigation.ts"));
});
after(async () => { unregister(); await vite.close(); });

const conversation = { id: 41, status: "executing", executionBackend: "codex", createdAt: "2026-09-08T00:00:00Z" };
const rows = [{ id: 420, conversationId: 41, senderType: "user", senderName: "user", msgType: "text", content: "accepted input", createdAt: conversation.createdAt }];

test("settings and history use one real envelope request; message abort signal is forwarded", async () => {
  navigation.clear(); const calls: string[] = []; const controller = new AbortController();
  get = async (path, options) => {
    calls.push(path);
    if (path.endsWith("/messages")) assert.equal(options.signal, controller.signal);
    return { data: { code: 0, message: "ok", data: path.endsWith("/messages") ? rows : conversation } };
  };
  const adapter = adapterFor(() => "41");
  const [model, backend, snapshot] = await Promise.all([
    api.getConversation(41), api.getConversation("41"), adapter.loadSnapshot({ signal: controller.signal }),
  ]);
  assert.equal(model.executionBackend, "codex"); assert.equal(backend.id, 41);
  assert.equal(calls.filter(path => path.endsWith("/41")).length, 1);
  assert.equal(snapshot.items[0].id, "msg-420");
});

test("accepted creation appears immediately and authoritative history replaces its temporary identity", async () => {
  navigation.clear();
  seed(conversation, { mode: "a2a_agent", input: "accepted input", attachments: [{ fileId: "file-1", name: "notes.txt" }] });
  const adapter = adapterFor(() => "41");
  const immediate = adapter.readCachedSnapshot();
  assert.equal(immediate.items[0].content, "accepted input");
  assert.equal(immediate.items[0].attachments[0].id, "file-1");
  assert.equal(immediate.status, "running");
  get = async path => ({ data: { code: 0, data: path.endsWith("/messages") ? rows : conversation } });
  const authoritative = await adapter.loadSnapshot({ signal: new AbortController().signal });
  assert.deepEqual(authoritative.items.map((item: any) => item.id), ["msg-420"]);
});

test("an aborted or retired adapter cannot map a late snapshot into the current account", async () => {
  navigation.clear(); const adapter = adapterFor(() => "41");
  get = async path => ({ data: { code: 0, data: path.endsWith("/messages") ? rows : conversation } });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(adapter.loadSnapshot({ signal: controller.signal }), { name: "AbortError" });
  token = "next-account";
  await assert.rejects(adapter.loadSnapshot({ signal: new AbortController().signal }), { name: "AbortError" });
  adapter.cacheSnapshot({ items: [], status: "completed", hasOlder: false });
  assert.equal(adapterFor(() => "41").readCachedSnapshot(), undefined);
});

test("a permission failure evicts the cached preview before the next visit", async () => {
  navigation.clear();
  const { ApiError } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  seed(conversation, { mode: "a2a_agent", input: "accepted input" });
  const adapter = adapterFor(() => "41");
  assert.ok(adapter.readCachedSnapshot());
  get = async () => { throw new ApiError("access denied", "FORBIDDEN", 403); };
  await assert.rejects(adapter.loadSnapshot({ signal: new AbortController().signal }), { status: 403 });
  assert.equal(adapterFor(() => "41").readCachedSnapshot(), undefined);
});
