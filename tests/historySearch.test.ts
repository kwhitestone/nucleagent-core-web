import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createTitleSearch } from "../src/addons/conversation/composables/historySearch.ts";

// MUYU-410: history title search (OWUI layout/SearchModal.svelte:106-149 schedule/fetchResults).
type Call = { q: string; beforeId?: number; resolve: (v: { data: { id: number }[]; hasMore: boolean }) => void; reject: (e: unknown) => void };
function fake() {
  const calls: Call[] = [];
  const fetchPage = (q: string, beforeId?: number) =>
    new Promise<{ data: { id: number }[]; hasMore: boolean }>((resolve, reject) => calls.push({ q, beforeId, resolve, reject }));
  return { calls, search: createTitleSearch(fetchPage as never, 0) };
}
const tick = () => new Promise(r => setTimeout(r, 0));
const ids = (s: ReturnType<typeof createTitleSearch>) => s.results.value.map(c => c.id);

test("trimmed query hits Core; blank query clears without a request", async () => {
  const { calls, search } = fake();
  search.query.value = "  季度 ";
  await tick();
  assert.deepEqual(calls.map(c => c.q), ["季度"]);
  assert.equal(search.active.value, true);
  assert.equal(search.loading.value, true);
  calls[0].resolve({ data: [{ id: 3 }], hasMore: false });
  await tick();
  assert.deepEqual(ids(search), [3]);
  assert.equal(search.loading.value, false);
  search.query.value = "   ";
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(search.active.value, false);
  assert.deepEqual(ids(search), []);
});

test("a stale response never overwrites a newer query", async () => {
  const { calls, search } = fake();
  search.query.value = "a";
  await tick();
  search.query.value = "ab";
  await tick();
  calls[1].resolve({ data: [{ id: 2 }], hasMore: false });
  await tick();
  calls[0].resolve({ data: [{ id: 9 }], hasMore: false });
  await tick();
  assert.deepEqual(ids(search), [2]);
  // clearing while a request is in flight drops its late answer too
  search.query.value = "abc";
  await tick();
  search.query.value = "";
  await tick();
  calls[2].resolve({ data: [{ id: 7 }], hasMore: false });
  await tick();
  assert.deepEqual(ids(search), []);
  assert.equal(search.loading.value, false);
});

test("more() pages by the last id and skips duplicates; failure sets error and retry works", async () => {
  const { calls, search } = fake();
  search.query.value = "x";
  await tick();
  calls[0].resolve({ data: [{ id: 9 }, { id: 7 }], hasMore: true });
  await tick();
  void search.more();
  assert.deepEqual([calls[1].q, calls[1].beforeId], ["x", 7]);
  calls[1].resolve({ data: [{ id: 7 }, { id: 4 }], hasMore: false });
  await tick();
  assert.deepEqual(ids(search), [9, 7, 4]);
  assert.equal(search.hasMore.value, false);

  search.query.value = "y";
  await tick();
  calls[2].reject(new Error("503"));
  await tick();
  assert.equal(search.failed.value, true);
  assert.equal(search.loading.value, false);
  assert.deepEqual(ids(search), []);
  void search.retry();
  assert.equal(calls[3].q, "y");
  assert.equal(search.failed.value, false);
  calls[3].resolve({ data: [{ id: 1 }], hasMore: false });
  await tick();
  assert.deepEqual(ids(search), [1]);
});

test("listConversations forwards q to Core", async () => {
  const { createServer } = await import("vite");
  const vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const seen: unknown[] = [];
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  const unregister = registerPlatformRuntime({
    http: { get: async (path: string, opts: { params: unknown }) => { seen.push([path, opts.params]); return { data: { code: 0, data: [{ id: 1 }], hasMore: true } }; } },
    getAccessToken: () => "t", getSessionVersion: () => 1,
  });
  try {
    const { listConversations } = await vite.ssrLoadModule("/src/addons/conversation/api/conversation.ts");
    const res = await listConversations({ q: "100%", beforeId: 5, limit: 20 });
    assert.deepEqual(seen, [["/api/v1/addons/conversation", { beforeId: 5, limit: 20, agentId: undefined, q: "100%" }]]);
    assert.deepEqual(res, { data: [{ id: 1 }], hasMore: true });
  } finally { unregister(); await vite.close(); }
});

test("task desk keeps its order and shows a separate search view", () => {
  const home = readFileSync(new URL("../src/addons/conversation/views/Home.vue", import.meta.url), "utf8");
  assert.match(home, /deskOrder\(store\.sorted\)/);
  // MUYU-365 batch 1: the search view lives in a lazily loaded DeskSearch; Home hides its own list while it is active.
  assert.match(home, /import\("@\/addons\/conversation\/components\/DeskSearch\.vue"\)/);
  assert.match(home, /<template v-if="!searching">[\s\S]*v-for="c in recent"/);
  const desk = readFileSync(new URL("../src/addons/conversation/components/DeskSearch.vue", import.meta.url), "utf8");
  assert.match(desk, /data-testid="desk-search"/);
  assert.match(desk, /<template v-if="search\.active\.value">[\s\S]*v-for="c in search\.results\.value"/);
});

test("shell search intents are validated before they reach Core", async () => {
  const { parseSearchIntent } = await import("../src/addons/conversation/composables/historySearch.ts");
  assert.deepEqual(parseSearchIntent({ source: "shell", type: "search", action: "query", q: "季度" }), { action: "query", q: "季度" });
  assert.deepEqual(parseSearchIntent({ source: "shell", type: "search", action: "more", q: "" }), { action: "more", q: "" });
  for (const bad of [null, "x", { source: "sub", type: "search", action: "query", q: "a" },
    { source: "shell", type: "search", action: "drop", q: "a" }, { source: "shell", type: "search", action: "query", q: 1 },
    { source: "shell", type: "search", action: "query", q: "x".repeat(81) }]) assert.equal(parseSearchIntent(bad), null);
});
