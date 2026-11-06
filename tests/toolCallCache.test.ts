import assert from "node:assert/strict";
import test from "node:test";

import { createToolCallCache, TOOL_CALL_CACHE_TTL_MS } from "../src/addons/administration/views/admin/toolCallCache.ts";

type Page = { rows: string[]; running?: boolean };

function setup() {
  const s = { owner: "tokA" as string | null, version: 1, now: 0, calls: 0 };
  const cache = createToolCallCache<Page>(
    { owner: () => s.owner, version: () => s.version, now: () => s.now },
    (p) => !p.running,
  );
  const load = (page: Page | Error) => () => { s.calls++; return page instanceof Error ? Promise.reject(page) : Promise.resolve(page); };
  return { s, cache, load };
}

test("identical concurrent loads share one request; hit within TTL, miss after", async () => {
  const { s, cache, load } = setup();
  const [a, b] = await Promise.all([cache.get(["872", 0, 30], load({ rows: ["1"] })), cache.get(["872", 0, 30], load({ rows: ["1"] }))]);
  assert.equal(s.calls, 1);
  assert.equal(a, b);
  s.now = TOOL_CALL_CACHE_TTL_MS - 1;
  await cache.get(["872", 0, 30], load({ rows: ["2"] }));
  assert.equal(s.calls, 1);
  s.now = TOOL_CALL_CACHE_TTL_MS + 1;
  assert.deepEqual((await cache.get(["872", 0, 30], load({ rows: ["3"] }))).rows, ["3"]);
  assert.equal(s.calls, 2);
});

test("task, cursor and limit are part of the key", async () => {
  const { s, cache, load } = setup();
  await cache.get(["872", 0, 30], load({ rows: [] }));
  await cache.get(["877", 0, 30], load({ rows: [] }));
  await cache.get(["872", 99, 30], load({ rows: [] }));
  await cache.get(["", 0, 30], load({ rows: [] }));
  assert.equal(s.calls, 4);
});

test("manual refresh bypasses and replaces the entry", async () => {
  const { s, cache, load } = setup();
  await cache.get(["872"], load({ rows: ["old"] }));
  assert.deepEqual((await cache.get(["872"], load({ rows: ["new"] }), true)).rows, ["new"]);
  assert.deepEqual((await cache.get(["872"], load({ rows: ["x"] }))).rows, ["new"]);
  assert.equal(s.calls, 2);
});

test("account switch, session/permission version change, sign-out and clear() never serve old pages", async () => {
  const { s, cache, load } = setup();
  await cache.get(["872"], load({ rows: ["A"] }));
  s.owner = "tokB";
  assert.deepEqual((await cache.get(["872"], load({ rows: ["B"] }))).rows, ["B"]);
  s.version = 2;
  assert.deepEqual((await cache.get(["872"], load({ rows: ["B2"] }))).rows, ["B2"]);
  s.owner = null;
  await cache.get(["872"], load({ rows: ["anon"] }));
  assert.equal(cache.size(), 0);
  s.owner = "tokB";
  await cache.get(["872"], load({ rows: ["B3"] }));
  cache.clear();
  assert.deepEqual((await cache.get(["872"], load({ rows: ["B4"] }))).rows, ["B4"]);
  assert.equal(s.calls, 6);
});

test("failures and pages with running calls are not cached", async () => {
  const { s, cache, load } = setup();
  await assert.rejects(cache.get(["404"], load(new Error("404"))));
  await Promise.resolve();
  assert.equal(cache.size(), 0);
  await cache.get(["872"], load({ rows: [], running: true }));
  await Promise.resolve();
  assert.equal(cache.size(), 0);
  await cache.get(["872"], load({ rows: [] }));
  assert.equal(s.calls, 3);
});

test("a clear() during an in-flight load does not let that result back in", async () => {
  const { s, cache } = setup();
  let resolve!: (p: Page) => void;
  const pending = cache.get(["872"], () => { s.calls++; return new Promise<Page>((r) => { resolve = r; }); });
  cache.clear(); // e.g. a new call was started while the page was loading
  resolve({ rows: ["stale"] });
  await pending;
  assert.equal(cache.size(), 0);
});
