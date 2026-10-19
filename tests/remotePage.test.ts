import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { effectScope, nextTick } from "vue";

let vite: ViteDevServer;
let useRemotePage: any;
before(async () => {
  vite = await createServer({ configFile: false, envFile: false, appType: "custom",
    optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  ({ useRemotePage } = await vite.ssrLoadModule("/src/composables/useRemotePage.ts"));
});
after(async () => { await vite?.close(); });

const page = (data: any[], number = 1, total = 51) => ({ data, page: number, pageSize: 20, total, hasMore: number * 20 < total });

test("remote page fences responses even when transport ignores cancellation", async () => {
  const scope = effectScope();
  const requests: any[] = [];
  const state = scope.run(() => useRemotePage((params: any, signal: AbortSignal) =>
    new Promise(resolve => requests.push({ params, signal, resolve }))));
  const first = state.load();
  state.query.value = "new";
  assert.equal(requests[0].signal.aborted, true);
  const second = state.load();
  requests[1].resolve(page([{ id: 2 }]));
  await second;
  requests[0].resolve(page([{ id: 1 }]));
  await first;
  assert.deepEqual(state.rows.value, [{ id: 2 }]);
  assert.equal(requests[1].params.search, "new");
  scope.stop();
});

test("page navigation retains query, recovers deleted last page and retries failures", async () => {
  const scope = effectScope();
  const requests: any[] = [];
  let fail = false;
  const state = scope.run(() => useRemotePage(async (params: any) => {
    requests.push(params);
    if (fail) throw new Error("offline");
    return page(params.page === 3 ? [] : [{ id: params.page }], params.page, 21);
  }));
  state.query.value = "needle";
  await state.go(3);
  assert.deepEqual(requests.map(r => r.page), [3, 2]);
  assert.ok(requests.every(r => r.search === "needle"));
  assert.equal(state.page.value, 2);
  fail = true;
  await state.load();
  assert.equal(state.failed.value, true);
  fail = false;
  await state.load();
  assert.equal(state.failed.value, false);
  state.query.value = "other";
  await nextTick();
  assert.equal(state.page.value, 1);
  scope.stop();
});
