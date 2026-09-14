import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import type { BroadcastFollowUpResult, Message } from "../src/addons/conversation/api/types.ts";
import type { ConversationAdapter, ConversationEvent, ItemUpsertEvent } from "../src/addons/conversation/task-conversation/core/types.ts";

let vite: ViteDevServer;
let createBroadcastAdapter: typeof import("../src/addons/conversation/composables/useBroadcastAdapter.ts").createBroadcastAdapter;
let createConversationAdapter: typeof import("../src/addons/conversation/composables/useConversationAdapter.ts").createConversationAdapter;
let navigation: typeof import("../src/addons/conversation/composables/conversationNavigation.ts").conversationNavigation;
let reducer: typeof import("../src/addons/conversation/task-conversation/core/reducer.ts");
let useConversation: typeof import("../src/addons/conversation/task-conversation/vue/useConversation.ts").useConversation;
let unregister: () => void;
let ApiError: typeof import("../src/contracts/platform-runtime.ts").ApiError;
let BroadcastApiError: typeof import("../src/addons/conversation/api/broadcast.ts").BroadcastApiError;
let get: (url: string, options?: { signal?: AbortSignal }) => Promise<unknown>;
let post: (url: string, body: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>;
const originalFetch = globalThis.fetch;
const originalFrame = globalThis.requestAnimationFrame;
const originalCancelFrame = globalThis.cancelAnimationFrame;
const base = "/api/v1/addons/conversation";
const envelope = (data: unknown) => ({ data: { code: 0, message: "ok", data } });
const command = (clientMessageId = "optimistic-1", content = "Continue") => ({ type: "send" as const, content, clientMessageId });
const options = () => ({ signal: new AbortController().signal });
const accepted = (id: number, groupId = "group/one"): BroadcastFollowUpResult => ({
  groupId, outcomes: [{ conversationId: id, backend: "codex", accepted: true }], skipped: null,
});
const message = (id: number, conversationId: number, content = "Continue"): Message => ({
  id, conversationId, content, senderType: "user", senderName: "user", msgType: "text",
  createdAt: "2026-09-09T00:00:00Z",
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
async function streamRows(adapter: ConversationAdapter, rows: Message[]): Promise<ItemUpsertEvent[]> {
  globalThis.fetch = async () => new Response(rows.map(row =>
    `id: ${row.id}\nevent: message-created\ndata: ${JSON.stringify(row)}\n\n`,
  ).join(""), { headers: { "Content-Type": "text/event-stream" } });
  const events: ConversationEvent[] = [];
  for await (const event of adapter.subscribe({ conversationKey: "ignored", ...options() })) events.push(event);
  return events.filter((event): event is ItemUpsertEvent => event.type === "item.upsert");
}

before(async () => {
  globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 0) as unknown as number;
  globalThis.cancelAnimationFrame = handle => clearTimeout(handle);
  vite = await createServer({
    appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  const platform = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  ApiError = platform.ApiError;
  unregister = platform.registerPlatformRuntime({
    http: {
      get: (url: string, config: { signal?: AbortSignal }) => get(url, config),
      post: (url: string, body: unknown, config: { signal?: AbortSignal }) => post(url, body, config),
    },
    getAccessToken: () => "broadcast-test", getSessionVersion: () => 1,
    apiBase: () => "", authHeaders: () => ({}),
  });
  ({ createConversationAdapter } = await vite.ssrLoadModule("/src/addons/conversation/composables/useConversationAdapter.ts"));
  ({ createBroadcastAdapter } = await vite.ssrLoadModule("/src/addons/conversation/composables/useBroadcastAdapter.ts"));
  ({ BroadcastApiError } = await vite.ssrLoadModule("/src/addons/conversation/api/broadcast.ts"));
  ({ conversationNavigation: navigation } = await vite.ssrLoadModule("/src/addons/conversation/composables/conversationNavigation.ts"));
  reducer = await vite.ssrLoadModule("/src/addons/conversation/task-conversation/core/reducer.ts");
  ({ useConversation } = await vite.ssrLoadModule("/src/addons/conversation/task-conversation/vue/useConversation.ts"));
});
beforeEach(() => {
  navigation?.clear();
  get = async () => { throw new Error("Unexpected GET"); };
  post = async () => { throw new Error("Unexpected POST"); };
  globalThis.fetch = async () => { throw new Error("Unexpected fetch"); };
});
after(async () => {
  globalThis.fetch = originalFetch;
  globalThis.requestAnimationFrame = originalFrame;
  globalThis.cancelAnimationFrame = originalCancelFrame;
  unregister?.();
  await vite?.close();
});

test("group sends preserve attachment refs and report all outcomes through the callback", async () => {
  const reports: unknown[] = [];
  const result = { ...accepted(41), skipped: [{ backend: "hermes", reason: "busy" as const }] };
  const adapter = createBroadcastAdapter({ groupId: "group/one", activeId: 41, onResult: value => reports.push(value) });
  const scope = options();
  post = async (url, body, config) => {
    assert.equal(url, `${base}/broadcast/group%2Fone/follow-up`);
    assert.deepEqual(body, { input: "Continue", attachments: [{ fileId: "file-1", name: "notes.txt" }] });
    assert.equal(config?.signal, scope.signal);
    return envelope(result);
  };
  const send = Object.freeze({ ...command(), attachments: Object.freeze([{ id: "file-1", name: "notes.txt", url: "private" }]) });
  assert.equal((await adapter.execute(send, scope)).accepted, true);
  assert.deepEqual(reports, [result]);
  assert.equal((await streamRows(adapter, [message(410, 41)]))[0].item.clientMessageId, send.clientMessageId);
});

test("a failing result callback cannot turn an accepted broadcast into a retryable send failure", async context => {
  const failure = new Error("Notification failed");
  const logs = context.mock.method(console, "error", () => undefined);
  for (const onResult of [
    () => { throw failure; },
    async () => { throw failure; },
  ]) {
    const adapter = createBroadcastAdapter({ groupId: "group/one", activeId: 45, onResult });
    post = async () => envelope(accepted(45));
    assert.equal((await adapter.execute(command("notification"), options())).accepted, true);
    assert.equal((await streamRows(adapter, [message(450, 45)]))[0].item.clientMessageId, "notification");
  }
  assert.equal(logs.mock.callCount(), 2);
  assert.ok(logs.mock.calls.every(call => call.arguments[1] === failure));
});

test("a skipped active sibling acknowledges global acceptance and clears its pending send", async () => {
  const reports: unknown[] = [];
  const result: BroadcastFollowUpResult = {
    ...accepted(42), outcomes: [
      { conversationId: 41, backend: "hermes", accepted: false, reason: "busy" },
      ...accepted(42).outcomes,
    ], skipped: [{ backend: "hermes", reason: "busy" }],
  };
  const adapter = createBroadcastAdapter({ groupId: "group/one", activeId: "41", onResult: value => reports.push(value) });
  post = async () => envelope(result);
  const response = await adapter.execute(command("skipped"), options());
  assert.deepEqual(response, { accepted: true, activeAccepted: false, message: response.message });
  assert.match(response.message ?? "", /41/);
  assert.match(response.message ?? "", /busy/i);
  assert.match(response.message ?? "", /accepted.*42/i);
  assert.deepEqual(reports, [result]);
  assert.equal((await streamRows(adapter, [message(411, 41)]))[0].item.clientMessageId, undefined);
});

test("missing active outcomes acknowledge other siblings without leaving an active pending message", async () => {
  const adapter = createBroadcastAdapter({ groupId: "group/one", activeId: 43 });
  post = async () => envelope(accepted(42));
  const response = await adapter.execute(command("missing"), options());
  assert.deepEqual(response, { accepted: true, activeAccepted: false, message: response.message });
  assert.match(response.message ?? "", /43/);
  assert.match(response.message ?? "", /not included|no outcome/i);
  assert.match(response.message ?? "", /accepted.*42/i);
  assert.equal((await streamRows(adapter, [message(431, 43)]))[0].item.clientMessageId, undefined);
});

test("no accepted sibling remains a failed command with a meaningful fallback reason", async () => {
  const adapter = createBroadcastAdapter({ groupId: "group/one", activeId: 44 });
  post = async () => envelope({
    groupId: "group/one", outcomes: [{ conversationId: 44, backend: "codex", accepted: false }], skipped: null,
  });
  const response = await adapter.execute(command("all-rejected"), options());
  assert.equal(response.accepted, false);
  assert.match(response.message ?? "", /44.*rejected/i);
  assert.equal((await streamRows(adapter, [message(441, 44)]))[0].item.clientMessageId, undefined);
});

test("an SSE user frame arriving before HTTP completion replaces the optimistic reducer item", async () => {
  const adapter = createBroadcastAdapter({ groupId: "group/one", activeId: 51 });
  const waiting = deferred<unknown>();
  const issued = deferred<void>();
  post = async () => { issued.resolve(); return waiting.promise; };
  const send = command("early-sse");
  const sending = adapter.execute(send, options());
  try {
    await issued.promise;
    const subscriptionAdapter = createBroadcastAdapter({ groupId: "group/one", activeId: 51 });
    const [event] = await streamRows(subscriptionAdapter, [message(510, 51)]);
    assert.equal(event.item.clientMessageId, send.clientMessageId);
    const initial = reducer.reduceConversation(reducer.createConversationState("51"), {
      type: "item.optimistic", item: {
        ...event.item, id: "optimistic-early", streamId: "optimistic-early", status: "pending", revision: 0, seq: 0,
      },
    });
    const reconciled = reducer.reduceConversation(initial, { type: "event.received", event });
    assert.deepEqual(Object.keys(reconciled.items), ["msg-510"]);
    assert.equal(reconciled.items["msg-510"].status, "complete");
  } finally { waiting.resolve(envelope(accepted(51))); await sending; }
  assert.equal((await streamRows(adapter, [message(511, 51)]))[0].item.clientMessageId, undefined);
});

test("failed and aborted sends remove optimistic registrations and do not notify success", async () => {
  for (const error of [new Error("HTTP failed"), new DOMException("Cancelled", "AbortError")]) {
    const reports: unknown[] = [];
    const adapter = createBroadcastAdapter({ groupId: "group/one", activeId: 61, onResult: value => reports.push(value) });
    post = async () => { throw error; };
    await assert.rejects(adapter.execute(command("failed"), options()), caught => caught === error);
    assert.deepEqual(reports, []);
    assert.equal((await streamRows(adapter, [message(610, 61)]))[0].item.clientMessageId, undefined);
  }
});

test("a late HTTP success after abort cannot report results or leave a pending active message", async () => {
  const reports: unknown[] = [];
  const adapter = createBroadcastAdapter({ groupId: "group/one", activeId: 64, onResult: value => reports.push(value) });
  const pending = deferred<unknown>();
  post = async () => pending.promise;
  const controller = new AbortController();
  const sending = adapter.execute(command("retired"), { signal: controller.signal });
  controller.abort();
  pending.resolve(envelope(accepted(64)));
  await assert.rejects(sending, { name: "AbortError" });
  assert.deepEqual(reports, []);
  assert.equal((await streamRows(adapter, [message(640, 64)]))[0].item.clientMessageId, undefined);
});

test("complete HTTP rejection reports skips before throwing and clears the active optimistic registration", async () => {
  const reports: unknown[] = [];
  const details = {
    skipped: [{ backend: "codex", reason: "queue_full" as const }],
    outcomes: [{ conversationId: 62, backend: "codex", accepted: false, reason: "queue_full" as const }],
  };
  const rejection = new BroadcastApiError(new ApiError("Queue full", "NETWORK_ERROR", 429), details);
  const adapter = createBroadcastAdapter({ groupId: "group/one", activeId: 62, onResult: value => reports.push(value) });
  post = async () => { throw rejection; };
  await assert.rejects(adapter.execute(command("all-failed"), options()), error => error === rejection);
  assert.deepEqual(reports, [{ groupId: "group/one", ...details }]);
  assert.equal((await streamRows(adapter, [message(620, 62)]))[0].item.clientMessageId, undefined);
});

test("complete HTTP cancellation failure reports each member before throwing", async () => {
  const reports: unknown[] = [];
  const failed = [{ conversationId: 63, backend: "codex", reason: "internal_error" as const }];
  const rejection = new BroadcastApiError(new ApiError("Cancellation failed", "NETWORK_ERROR", 500), { failed });
  const adapter = createBroadcastAdapter({ groupId: "group/one", activeId: 63, onResult: value => reports.push(value) });
  post = async () => { throw rejection; };
  await assert.rejects(adapter.execute({ type: "stop" }, options()), error => error === rejection);
  assert.deepEqual(reports, [{ groupId: "group/one", cancelled: [], failed }]);
});

test("pending identical messages stay isolated by sibling and are consumed only once", async () => {
  const first = createBroadcastAdapter({ groupId: "one", activeId: 71 });
  const second = createBroadcastAdapter({ groupId: "two", activeId: 72 });
  post = async url => envelope(url.includes("/one/") ? accepted(71, "one") : accepted(72, "two"));
  await first.execute(command("first"), options());
  await second.execute(command("second"), options());
  const [secondEvent] = await streamRows(second, [message(720, 72)]);
  const [firstEvent, repeated] = await streamRows(first, [message(710, 71), message(711, 71)]);
  assert.equal(secondEvent.item.clientMessageId, "second");
  assert.equal(firstEvent.item.clientMessageId, "first");
  assert.equal(repeated.item.clientMessageId, undefined);
});

test("identities are captured once for history, cache, SSE, interaction and group commands", async () => {
  const source = { groupId: "original/group", activeId: "81" };
  const adapter = createBroadcastAdapter(source);
  source.groupId = "new-group"; source.activeId = "82";
  const paths: string[] = [];
  get = async url => {
    paths.push(url);
    return envelope(url.endsWith("/messages") ? [message(810, 81)] : { id: 81, status: "completed" });
  };
  const snapshot = await adapter.loadSnapshot({ conversationKey: "82", ...options() });
  assert.deepEqual(paths.sort(), [`${base}/81`, `${base}/81/messages`]);
  adapter.cacheSnapshot?.(snapshot);
  const cached = createConversationAdapter(() => "81").readCachedSnapshot?.();
  assert.deepEqual(cached, adapter.readCachedSnapshot?.());
  assert.equal(cached?.items[0].id, "msg-810");
  assert.equal(cached?.status, snapshot.status);
  assert.equal(createConversationAdapter(() => "82").readCachedSnapshot?.(), undefined);
  assert.deepEqual(await adapter.loadOlder({ conversationKey: "82", ...options() }), { items: [], hasOlder: false });
  globalThis.fetch = async url => {
    assert.equal(url, `${base}/81/messages/stream`);
    return new Response("");
  };
  for await (const _event of adapter.subscribe({ conversationKey: "82", ...options() })) assert.fail("Empty stream");
  post = async (url, body) => {
    paths.push(url);
    if (url.endsWith("/clarify")) assert.deepEqual(body, { requestId: "question-1", answer: "yes" });
    return envelope(url.endsWith("/follow-up") ? accepted(81, "original/group") : { groupId: "original/group", cancelled: [81], failed: [] });
  };
  await adapter.execute({ type: "interaction.respond", interactionId: "question-1", value: "yes" }, options());
  await adapter.execute(command("captured"), options());
  await adapter.execute({ type: "stop" }, options());
  assert.deepEqual(paths.slice(2), [
    `${base}/81/clarify`, `${base}/broadcast/original%2Fgroup/follow-up`, `${base}/broadcast/original%2Fgroup/cancel`,
  ]);
  assert.equal((await streamRows(adapter, [message(811, 81)]))[0].item.clientMessageId, "captured");
  assert.deepEqual(await adapter.execute({ type: "retry" }, options()), { accepted: false, message: "Unsupported command" });
  assert.equal(typeof adapter.uploadAttachment, "function");
});

test("group cancellation forwards its abort signal and never treats an inaccessible group as stopped", async () => {
  const reports: unknown[] = [];
  const adapter = createBroadcastAdapter({ groupId: "group/one", activeId: 91, onResult: value => reports.push(value) });
  const scope = options();
  const result = { groupId: "group/one", cancelled: null, failed: [] };
  post = async (url, body, config) => {
    assert.equal(url, `${base}/broadcast/group%2Fone/cancel`);
    assert.equal(body, undefined);
    assert.equal(config?.signal, scope.signal);
    return envelope(result);
  };
  assert.equal((await adapter.execute({ type: "stop" }, scope)).accepted, true);
  assert.deepEqual(reports, [result]);
  const missing = new ApiError("Group not found", "NOT_FOUND", 404);
  post = async () => { throw missing; };
  await assert.rejects(adapter.execute({ type: "stop" }, options()), caught => caught === missing);
  assert.deepEqual(reports, [result]);
});

test("partial cancellation reports failures and leaves a failed active member subscribed", async () => {
  const reports: unknown[] = [];
  const result = {
    groupId: "group/one", cancelled: [92],
    failed: [{ conversationId: 91, backend: "codex", reason: "internal_error" }],
  };
  const adapter = createBroadcastAdapter({ groupId: "group/one", activeId: 91, onResult: value => reports.push(value) });
  post = async () => envelope(result);
  const response = await adapter.execute({ type: "stop" }, options());
  assert.equal(response.accepted, false);
  assert.match(response.message ?? "", /91.*internal_error/);
  assert.match(response.message ?? "", /92/);
  assert.deepEqual(reports, [result]);

  const stopped = createBroadcastAdapter({ groupId: "group/one", activeId: 92, onResult: value => reports.push(value) });
  assert.equal((await stopped.execute({ type: "stop" }, options())).accepted, true);
  assert.deepEqual(reports, [result, result]);
});

test("ordinary single-conversation send, failure cleanup and idempotent stop are preserved", async () => {
  const adapter = createConversationAdapter(() => "101");
  post = async (url, body) => {
    assert.equal(url, `${base}/101/follow-up`);
    assert.deepEqual(body, { input: "Continue" });
    const [event] = await streamRows(createConversationAdapter(() => "101"), [message(1010, 101)]);
    assert.equal(event.item.clientMessageId, "ordinary");
    return envelope({ id: 101 });
  };
  assert.deepEqual(await adapter.execute(command("ordinary"), options()), { accepted: true });
  post = async () => { throw new Error("ordinary failure"); };
  await assert.rejects(adapter.execute(command("ordinary-failed"), options()), /ordinary failure/);
  assert.equal((await streamRows(adapter, [message(1011, 101)]))[0].item.clientMessageId, undefined);
  post = async url => {
    assert.equal(url, `${base}/101/cancel`);
    throw new ApiError("not running", "NOT_FOUND", 404);
  };
  assert.deepEqual(await adapter.execute({ type: "stop" }, options()), { accepted: true });
  const failed = new ApiError("unavailable", "UNAVAILABLE", 503);
  post = async () => { throw failed; };
  await assert.rejects(adapter.execute({ type: "stop" }, options()), caught => caught === failed);
});

test("partial broadcast acceptance keeps submit successful and reconciles the skipped active conversation", { timeout: 5_000 }, async () => {
  const errors: Error[] = [];
  const streamSignals: AbortSignal[] = [];
  let snapshotReads = 0;
  let sends = 0;
  const adapter = createBroadcastAdapter({ groupId: "group/one", activeId: 111 });
  get = async url => {
    if (!url.endsWith("/messages") && ++snapshotReads > 1) {
      assert.equal(streamSignals[0].aborted, true, "retire the old stream before reseeding versions");
    }
    return envelope(url.endsWith("/messages") ? [message(1110, 111, "previous input")] : { id: 111, status: "completed" });
  };
  post = async () => {
    sends++;
    return envelope({
      ...accepted(112), outcomes: [
        { conversationId: 111, backend: "hermes", accepted: false, reason: "unavailable" }, ...accepted(112).outcomes,
      ], skipped: [{ backend: "hermes", reason: "unavailable" }],
    });
  };
  globalThis.fetch = async (_url, config) => new Response(new ReadableStream({
    start(stream) {
      streamSignals.push(config!.signal!);
      if (config?.signal?.aborted) stream.close();
      else config?.signal?.addEventListener("abort", () => stream.close(), { once: true });
    },
  }));
  const controller = useConversation({
    conversationKey: () => "111", adapter: () => adapter,
    onConnectionChange() {}, onStatusChange() {}, onError(error) { errors.push(error); },
  });
  try {
    await controller.initialize();
    await controller.send("Continue");
    assert.deepEqual(errors, []);
    assert.deepEqual(Object.keys(controller.state.value.items), ["msg-1110"]);
    assert.equal(controller.state.value.status, "completed");
    assert.equal(snapshotReads, 2);
    assert.equal(sends, 1);
    assert.equal(streamSignals.length, 2);
    assert.equal(streamSignals[1].aborted, false);
  } finally { controller.dispose(); }
});

test("partial acceptance never restores the draft when active snapshot reconciliation fails", { timeout: 5_000 }, async () => {
  for (const status of [503, 401]) {
    const errors: Error[] = [];
    const failure = new ApiError("Snapshot failed", "UNAVAILABLE", status);
    const adapter = createBroadcastAdapter({ groupId: "group/one", activeId: 131 });
    let failSnapshot = false;
    get = async url => {
      if (failSnapshot) throw failure;
      return envelope(url.endsWith("/messages") ? [] : { id: 131, status: "completed" });
    };
    post = async () => {
      failSnapshot = true;
      return envelope(accepted(132));
    };
    globalThis.fetch = async (_url, config) => new Response(new ReadableStream({
      start(stream) {
        if (config?.signal?.aborted) stream.close();
        else config?.signal?.addEventListener("abort", () => stream.close(), { once: true });
      },
    }));
    const controller = useConversation({
      conversationKey: () => "131", adapter: () => adapter,
      onConnectionChange() {}, onStatusChange() {}, onError(error) { errors.push(error); },
    });
    try {
      await controller.initialize();
      // TaskConversation restores the composer only if this promise rejects.
      await assert.doesNotReject(controller.send("Accepted elsewhere"));
      assert.deepEqual(controller.state.value.items, {});
      assert.notEqual(controller.state.value.status, "running");
      assert.equal(controller.authoritativeReady.value, false);
      assert.ok(errors.includes(failure));
    } finally { controller.dispose(); }
  }
});

test("a skipped active send cannot reconcile or report errors into a newer controller lifecycle", { timeout: 5_000 }, async () => {
  const errors: Error[] = [];
  const refreshing = deferred<void>();
  const snapshot = deferred<unknown>();
  void snapshot.promise.catch(() => undefined);
  let activeId = "141";
  let adapter = createBroadcastAdapter({ groupId: "group/one", activeId });
  let refresh = false;
  get = async url => {
    if (refresh && url === `${base}/141`) {
      refreshing.resolve();
      return snapshot.promise;
    }
    return envelope(url.endsWith("/messages") ? [] : { id: Number(activeId), status: "completed" });
  };
  post = async () => { refresh = true; return envelope(accepted(142)); };
  globalThis.fetch = async (_url, config) => new Response(new ReadableStream({
    start(stream) {
      if (config?.signal?.aborted) stream.close();
      else config?.signal?.addEventListener("abort", () => stream.close(), { once: true });
    },
  }));
  const controller = useConversation({
    conversationKey: () => activeId, adapter: () => adapter,
    onConnectionChange() {}, onStatusChange() {}, onError(error) { errors.push(error); },
  });
  let sending: Promise<void> | undefined;
  try {
    await controller.initialize();
    sending = controller.send("Continue");
    // Retain a handler if the regression rejects before reaching reconciliation.
    void sending.catch(() => refreshing.resolve());
    await refreshing.promise;
    activeId = "143";
    adapter = createBroadcastAdapter({ groupId: "group/two", activeId });
    await controller.initialize();
    snapshot.reject(new Error("obsolete snapshot failed"));
    await assert.doesNotReject(sending);
    assert.deepEqual(errors, []);
    assert.equal(controller.state.value.conversationKey, "143");
    assert.equal(controller.state.value.status, "completed");
    assert.deepEqual(controller.state.value.items, {});
  } finally {
    snapshot.resolve(envelope({ id: 141, status: "completed" }));
    controller.dispose();
  }
});

test("a failed active cancellation preserves its running controller and SSE while reporting cancelled siblings", { timeout: 5_000 }, async () => {
  const errors: Error[] = [];
  const reports: unknown[] = [];
  const adapter = createBroadcastAdapter({ groupId: "group/one", activeId: 121, onResult: result => reports.push(result) });
  get = async url => envelope(url.endsWith("/messages") ? [message(1210, 121)] : { id: 121, status: "executing" });
  const result = {
    groupId: "group/one", cancelled: [122],
    failed: [{ conversationId: 121, backend: "codex", reason: "internal_error" }],
  };
  post = async () => envelope(result);
  const subscribed = deferred<void>();
  let streamAborted = false;
  globalThis.fetch = async (_url, config) => new Response(new ReadableStream({
    start(stream) {
      subscribed.resolve();
      config?.signal?.addEventListener("abort", () => {
        streamAborted = true;
        stream.close();
      }, { once: true });
    },
  }));
  const controller = useConversation({
    conversationKey: () => "121", adapter: () => adapter,
    onConnectionChange() {}, onStatusChange() {}, onError(error) { errors.push(error); },
  });
  try {
    await controller.initialize();
    await subscribed.promise;
    await assert.rejects(controller.stop(), /121.*internal_error/);
    assert.equal(controller.state.value.status, "running");
    assert.equal(streamAborted, false);
    assert.equal(errors.length, 1);
    assert.deepEqual(reports, [result]);
  } finally { controller.dispose(); }
});
