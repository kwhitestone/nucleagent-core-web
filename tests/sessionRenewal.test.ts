import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";
import type { ConversationAdapter } from "../src/addons/conversation/task-conversation/core/types.ts";

// MUYU-365 exp98 W1: "Conversation session changed" after a same-account token renewal
// (exp97 ROOT-CAUSE C; replaces exp97/tools/sim-navigation-scope.mjs as a unit test).
let vite: ViteDevServer;
let dom: JSDOM;
let unregister: () => void;
let adapterFor: (id: () => string) => ConversationAdapter;
let navigation: { clear(): void };
let createConversationController: typeof import("../src/addons/conversation/task-conversation/conversationController.ts").createConversationController;
let observableBoxes: typeof import("../src/chat-react/observableBox.ts").observableBoxes;
let session = { token: "jwt-A" as string | null, version: 3 };
let get: (path: string, options?: unknown) => Promise<unknown>;

const conversation = { id: 1007, status: "completed", executionBackend: "codex", createdAt: "2026-11-20T00:00:00Z" };
const rows = [{ id: 1, conversationId: 1007, senderType: "user", senderName: "user", msgType: "text", content: "hi", createdAt: conversation.createdAt }];
const okGet = async (path: string) => ({ data: { code: 0, data: path.endsWith("/messages") ? rows : conversation } });
const sessionChanged = () => new DOMException("Conversation session changed", "AbortError");
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

before(async () => {
  dom = new JSDOM("");
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime({
    http: { get: (path: string, options: unknown) => get(path, options) },
    getAccessToken: () => session.token, getSessionVersion: () => session.version,
  });
  ({ createConversationAdapter: adapterFor } = await vite.ssrLoadModule("/src/addons/conversation/composables/useConversationAdapter.ts") as never);
  ({ conversationNavigation: navigation } = await vite.ssrLoadModule("/src/addons/conversation/composables/conversationNavigation.ts") as never);
  ({ createConversationController } = await vite.ssrLoadModule("/src/addons/conversation/task-conversation/conversationController.ts"));
  ({ observableBoxes } = await vite.ssrLoadModule("/src/chat-react/observableBox.ts"));
});
after(async () => { unregister(); await vite.close(); dom.window.close(); });

test("an adapter created before a same-account token renewal still loads its snapshot afterwards", async () => {
  navigation.clear(); session = { token: "jwt-A", version: 3 }; get = okGet;
  const adapter = adapterFor(() => "1007");                       // adapter creation (useConversationAdapter.ts:421)
  session = { token: "jwt-A-renewed", version: 3 };               // shell pushes a renewed access token
  const snapshot = await adapter.loadSnapshot({ conversationKey: "1007", signal: new AbortController().signal } as never);
  assert.deepEqual(snapshot.items.map(item => item.id), ["msg-1"]);
  session = { token: "jwt-A-renewed", version: 4 };               // revalidation bumps the session version
  const again = await adapter.loadSnapshot({ conversationKey: "1007", signal: new AbortController().signal } as never);
  assert.equal(again.items.length, 1);
  // The cache follows the scope of the call, so the renewed scope can store and restore previews.
  adapter.cacheSnapshot?.(again);
  assert.equal(adapter.readCachedSnapshot?.()?.items.length, 1);
});

test("an identity change while a snapshot request is in flight is still rejected", async () => {
  navigation.clear(); session = { token: "jwt-A", version: 3 };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  get = async path => { await gate; return okGet(path); };
  const adapter = adapterFor(() => "1007");
  const pending = adapter.loadSnapshot({ conversationKey: "1007", signal: new AbortController().signal } as never);
  session = { token: "jwt-B", version: 4 };                        // another principal signs in mid-request
  release();
  await assert.rejects(pending, { name: "AbortError", message: "Conversation session changed" });
});

test("a snapshot loaded for one account is never cached into the next account's scope", async () => {
  navigation.clear(); session = { token: "jwt-A", version: 3 }; get = okGet;
  const adapter = adapterFor(() => "1007");
  const snapshot = await adapter.loadSnapshot({ conversationKey: "1007", signal: new AbortController().signal } as never);
  session = { token: "jwt-B", version: 4 };
  adapter.cacheSnapshot?.(snapshot);                               // controller.saveSnapshot on dispose/initialize
  assert.equal(adapterFor(() => "1007").readCachedSnapshot?.(), undefined);
});

test("controller: a session-changed abort re-initializes once, without a toast or an endless same-argument retry", async () => {
  let calls = 0;
  const adapter = {
    async loadSnapshot() { calls++; if (calls === 1) throw sessionChanged(); return { status: "completed", hasOlder: false, cursor: "1", items: [] }; },
    async *subscribe({ signal }: { signal: AbortSignal }) { await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })); },
  } as unknown as ConversationAdapter;
  const errors: Error[] = [];
  const { box } = observableBoxes();
  const c = createConversationController({ conversationKey: () => "1007", adapter: () => adapter, onConnectionChange() {}, onStatusChange() {}, onError: e => errors.push(e) }, box);
  try {
    await c.initialize();
    await sleep(50);
    assert.deepEqual(errors.map(e => e.message), [], "session changed is not a user-facing error");
    assert.equal(c.authoritativeReady.value, true, "recovered through a fresh initialize");
    assert.equal(calls, 2);
  } finally { c.dispose(); }
});

test("controller: a persistent session-changed abort stops after one recovery instead of retrying forever", async () => {
  let calls = 0;
  const adapter = {
    async loadSnapshot() { calls++; throw sessionChanged(); },
    async *subscribe() { /* never reached */ },
  } as unknown as ConversationAdapter;
  const errors: Error[] = [];
  const { box } = observableBoxes();
  const c = createConversationController({ conversationKey: () => "1007", adapter: () => adapter, onConnectionChange() {}, onStatusChange() {}, onError: e => errors.push(e) }, box);
  try {
    await c.initialize();
    await sleep(1_800);                                            // the old backoff (0.75s, 1.5s…) would have retried
    assert.equal(calls, 2, "one initial load plus one recovery");
    assert.deepEqual(errors, []);
    assert.equal(c.state.value.connection.status, "error");
  } finally { c.dispose(); }
});

test("controller: a session-changed abort while reconnecting the stream also recovers via initialize", async () => {
  let calls = 0; let streams = 0;
  const adapter = {
    async loadSnapshot() { calls++; if (calls === 2) throw sessionChanged(); return { status: "completed", hasOlder: false, cursor: String(calls), items: [] }; },
    async *subscribe({ signal }: { signal: AbortSignal }) {
      streams++;
      if (streams === 1) return;                                   // proxy idle-closes the SSE stream
      await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
    },
  } as unknown as ConversationAdapter;
  const errors: Error[] = [];
  const { box } = observableBoxes();
  const c = createConversationController({ conversationKey: () => "1007", adapter: () => adapter, onConnectionChange() {}, onStatusChange() {}, onError: e => errors.push(e) }, box);
  try {
    await c.initialize();
    await sleep(1_200);
    assert.equal(calls, 3, "initial, failed reconcile, recovered initialize");
    assert.equal(c.authoritativeReady.value, true);
    assert.deepEqual(errors.map(e => e.message), ["Conversation stream disconnected"]);
  } finally { c.dispose(); }
});
