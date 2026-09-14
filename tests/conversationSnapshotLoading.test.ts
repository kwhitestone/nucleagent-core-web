import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createSSRApp, h, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { createI18n } from "vue-i18n";
import { createServer, type ViteDevServer } from "vite";
import type { ConversationAdapter, ConversationSnapshot } from "../src/addons/conversation/task-conversation/core/types.ts";

let vite: ViteDevServer;
let useConversation: typeof import("../src/addons/conversation/task-conversation/vue/useConversation.ts").useConversation;
let TaskConversation: Component;

before(async () => {
  Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0) });
  Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: clearTimeout });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  ({ useConversation } = await vite.ssrLoadModule("/src/addons/conversation/task-conversation/vue/useConversation.ts"));
  ({ default: TaskConversation } = await vite.ssrLoadModule("/src/addons/conversation/task-conversation/vue/TaskConversation.vue"));
});
after(async () => {
  await vite.close();
  Reflect.deleteProperty(globalThis, "requestAnimationFrame");
  Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
function snapshot(id?: string): ConversationSnapshot {
  return {
    status: "completed", hasOlder: false, cursor: id ?? "empty",
    items: id ? [{ id, turnId: "main", streamId: id, lane: "answer", role: "user", kind: "text", content: id,
      status: "complete", revision: 1, seq: 1, timestamp: "2026-09-08T00:00:00Z" }] : [],
  };
}
function adapterFor(load: ConversationAdapter["loadSnapshot"], extra: Partial<ConversationAdapter> = {}): ConversationAdapter {
  return {
    loadSnapshot: load, async loadOlder() { return { items: [], hasOlder: false }; },
    async *subscribe(request) {
      await new Promise<void>(resolve => {
        if (request.signal.aborted) resolve();
        else request.signal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
    async execute() { return { accepted: true }; }, ...extra,
  };
}
function controllerFor(getAdapter: () => ConversationAdapter, key = () => "A") {
  const errors: Error[] = [];
  const controller = useConversation({ conversationKey: key, adapter: getAdapter,
    onConnectionChange() {}, onStatusChange() {}, onError(error) { errors.push(error); } });
  return { controller, errors };
}

test("first snapshot stays loading until success, including a confirmed empty conversation", async () => {
  for (const resolved of [snapshot("persisted-user"), snapshot()]) {
    const pending = deferred<ConversationSnapshot>();
    const adapter = adapterFor(() => pending.promise);
    const { controller } = controllerFor(() => adapter);
    try {
      assert.equal(controller.snapshotStatus.value, "loading");
      const work = controller.initialize();
      assert.equal(controller.snapshotStatus.value, "loading");
      pending.resolve(resolved);
      await work;
      assert.equal(controller.snapshotStatus.value, "ready");
      assert.equal(Object.keys(controller.state.value.items).length, resolved.items.length);
    } finally { controller.dispose(); }
  }
});

test("failed first snapshot is an error rather than an empty successful conversation", async () => {
  let saves = 0;
  const adapter = adapterFor(async () => { throw new Error("current history failed"); }, { cacheSnapshot() { saves++; } });
  const { controller, errors } = controllerFor(() => adapter);
  await controller.initialize();
  assert.equal(controller.snapshotStatus.value, "error");
  assert.equal(errors.length, 1);
  controller.dispose();
  assert.equal(saves, 0, "failed first load must not replace a valid cache with empty state");
});

test("cached history is available synchronously and replaced by the real snapshot", async () => {
  const pending = deferred<ConversationSnapshot>();
  const adapter = adapterFor(() => pending.promise, { readCachedSnapshot: () => snapshot("cached-user") });
  const { controller } = controllerFor(() => adapter);
  try {
    const work = controller.initialize();
    assert.equal(controller.snapshotStatus.value, "ready");
    assert.ok(controller.state.value.items["cached-user"]);
    pending.resolve(snapshot("reconciled-user"));
    await work;
    assert.equal(controller.state.value.items["cached-user"], undefined);
    assert.ok(controller.state.value.items["reconciled-user"]);
  } finally { controller.dispose(); }
});

test("cached display cannot execute a command or start SSE before authoritative history settles", async () => {
  const pending = deferred<ConversationSnapshot>();
  let commands = 0, subscriptions = 0;
  const base = adapterFor(() => pending.promise);
  const adapter = adapterFor(() => pending.promise, {
    readCachedSnapshot: () => ({ ...snapshot("cached-user"), status: "running" }),
    async execute() { commands++; return { accepted: true }; },
    async *subscribe(request) { subscriptions++; yield* base.subscribe(request); },
  });
  const { controller } = controllerFor(() => adapter);
  try {
    const work = controller.initialize();
    assert.equal(controller.snapshotStatus.value, "ready");
    assert.equal(controller.authoritativeReady.value, false);
    for (const command of [() => controller.send("new input"), () => controller.retry(), () => controller.rerun(),
      () => controller.respond("question", "answer"), () => controller.stop()]) {
      await assert.rejects(command, /history.*loading/i);
    }
    assert.equal(commands, 0);
    assert.equal(subscriptions, 0);
    assert.deepEqual(Object.keys(controller.state.value.items), ["cached-user"]);
    pending.resolve(snapshot("authoritative-user"));
    await work;
    assert.equal(controller.authoritativeReady.value, true);
    assert.ok(controller.state.value.items["authoritative-user"]);
    assert.equal(controller.state.value.items["cached-user"], undefined);
    assert.equal(subscriptions, 1);
    await controller.send("now allowed");
    assert.equal(commands, 1);
  } finally { controller.dispose(); }
});

test("invalid optional cache cannot prevent loading the real history", async () => {
  let loads = 0;
  const adapter = adapterFor(async () => { loads++; return snapshot("authoritative-user"); }, {
    readCachedSnapshot: () => ({ items: "corrupt" } as unknown as ConversationSnapshot),
  });
  const { controller } = controllerFor(() => adapter);
  try {
    await controller.initialize();
    assert.equal(loads, 1);
    assert.equal(controller.snapshotStatus.value, "ready");
    assert.ok(controller.state.value.items["authoritative-user"]);
  } finally { controller.dispose(); }
});

test("failed reconciliation preserves cached history while exposing its error", async () => {
  const adapter = adapterFor(async () => { throw new Error("refresh failed"); }, { readCachedSnapshot: () => snapshot("cached-user") });
  const { controller, errors } = controllerFor(() => adapter);
  try {
    await controller.initialize();
    assert.equal(controller.snapshotStatus.value, "error");
    assert.ok(controller.state.value.items["cached-user"]);
    assert.equal(errors.length, 1);
  } finally { controller.dispose(); }
});

test("authorization failure clears cached account data and cannot save it again", async () => {
  for (const status of [401, 403]) {
    let saves = 0;
    const adapter = adapterFor(async () => { throw Object.assign(new Error("access denied"), { status }); }, {
      readCachedSnapshot: () => snapshot("private-cached-user"), cacheSnapshot() { saves++; },
    });
    const { controller } = controllerFor(() => adapter);
    await controller.initialize();
    assert.equal(controller.snapshotStatus.value, "error");
    assert.deepEqual(Object.keys(controller.state.value.items), [], "denied cache remained visible");
    controller.dispose();
    assert.equal(saves, 0);
  }
});

test("authorization failure also discards queued stream frames", async () => {
  let saves = 0;
  const adapter = adapterFor(async () => snapshot("private-user"), {
    cacheSnapshot() { saves++; },
    async *subscribe() {
      const item = { ...snapshot("queued-private-user").items[0], status: "streaming" as const };
      yield { protocolVersion: 2, type: "item.upsert", conversationKey: "A", eventId: "queued", cursor: "next",
        turnId: item.turnId, streamId: item.streamId, lane: item.lane, revision: 1, seq: 1, timestamp: item.timestamp, item };
      throw Object.assign(new Error("access denied"), { status: 403 });
    },
  });
  const { controller } = controllerFor(() => adapter);
  try {
    await controller.initialize();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(controller.snapshotStatus.value, "error");
    assert.deepEqual(Object.keys(controller.state.value.items), [], "queued frame restored denied data");
  } finally { controller.dispose(); }
  assert.equal(saves, 0);
});

test("A-B-A late successes and failures cannot settle the latest loading state", async () => {
  const first = deferred<ConversationSnapshot>(), second = deferred<ConversationSnapshot>(), latest = deferred<ConversationSnapshot>();
  let key = "A", calls = 0;
  const pending = [first, second, latest];
  const adapter = adapterFor(() => pending[calls++].promise);
  const { controller, errors } = controllerFor(() => adapter, () => key);
  try {
    const oldA = controller.initialize();
    key = "B";
    const oldB = controller.initialize();
    key = "A";
    const newA = controller.initialize();
    first.resolve(snapshot("obsolete-A"));
    second.reject(new Error("obsolete-B failure"));
    await Promise.all([oldA, oldB]);
    assert.equal(controller.snapshotStatus.value, "loading");
    assert.deepEqual(Object.keys(controller.state.value.items), []);
    assert.equal(errors.length, 0);
    latest.resolve(snapshot("current-A"));
    await newA;
    assert.equal(controller.snapshotStatus.value, "ready");
    assert.ok(controller.state.value.items["current-A"]);
  } finally { controller.dispose(); }
});

test("route transition saves the old state through its original adapter and keeps all loaded rows", async () => {
  const savedA: ConversationSnapshot[] = [], savedB: ConversationSnapshot[] = [];
  const populated = { ...snapshot(), hasOlder: true, items: Array.from({ length: 200 }, (_, index) => snapshot(`user-${index}`).items[0]) };
  const older = Array.from({ length: 200 }, (_, index) => snapshot(`older-${index}`).items[0]);
  const a = adapterFor(async () => populated, { async loadOlder() { return { items: older, hasOlder: false }; }, cacheSnapshot(value) { savedA.push(value); } });
  const b = adapterFor(async () => snapshot("B"), { cacheSnapshot(value) { savedB.push(value); } });
  let active = a, key = "A";
  const { controller } = controllerFor(() => active, () => key);
  await controller.initialize();
  await controller.loadOlder();
  assert.equal(controller.state.value.loadedOrder.length, 400);
  assert.ok(controller.state.value.order.length < 400, "fixture must exceed the render window");
  active = b; key = "B";
  await controller.initialize();
  assert.equal(savedA.length, 1);
  assert.equal(savedA[0].items.length, 400);
  assert.equal(savedB.length, 0, "new adapter must not receive the old conversation's cache");
  controller.dispose();
  assert.equal(savedB[0].items[0].id, "B");
  assert.deepEqual(Object.keys(controller.state.value.items), [], "retired controller must release visible account data");
});

test("dispose cannot be repopulated by a late first snapshot", async () => {
  const pending = deferred<ConversationSnapshot>();
  let saves = 0;
  const adapter = adapterFor(() => pending.promise, { cacheSnapshot() { saves++; } });
  const { controller, errors } = controllerFor(() => adapter);
  const work = controller.initialize();
  controller.dispose();
  pending.resolve(snapshot("old-account"));
  await work;
  assert.deepEqual(Object.keys(controller.state.value.items), []);
  assert.equal(controller.snapshotStatus.value, "loading");
  assert.equal(errors.length, 0);
  assert.equal(saves, 0);
});

test("the first rendered conversation view shows loading rather than the empty invitation", async () => {
  const app = createSSRApp({ render: () => h(TaskConversation, { conversationKey: "A", adapter: adapterFor(async () => snapshot()) }) });
  app.use(createI18n({ legacy: false, locale: "zh-CN", messages: { "zh-CN": {} } }));
  const html = await renderToString(app);
  assert.match(html, /正在加载对话/);
  assert.doesNotMatch(html, /开始一段新对话/);
  assert.doesNotMatch(html, /class="atc-empty"/);
});
