import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createServer, type ViteDevServer } from "vite";

let vite: ViteDevServer;
let useConversation: (options: Record<string, unknown>) => {
  initialize: () => Promise<void>;
  stop: () => Promise<void>;
  dispose: () => void;
  state: {
    value: {
      status: string;
      items: Record<string, { status: string; data?: Record<string, unknown> }>;
      connection: { status: string };
    };
  };
};
let isIdempotentStopError: (error: unknown) => boolean;
let ApiError: new (message: string, code: string, status: number) => Error;

before(async () => {
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) =>
      globalThis.setTimeout(() => callback(performance.now()), 0),
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: (handle: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(handle),
  });
  vite = await createServer({
    appType: "custom",
    optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  ({ useConversation } = await vite.ssrLoadModule(
    "/src/addons/conversation/task-conversation/vue/useConversation.ts",
  ));
  ({ isIdempotentStopError } = await vite.ssrLoadModule(
    "/src/addons/conversation/composables/useConversationAdapter.ts",
  ));
  ({ ApiError } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts"));
});

after(async () => {
  await vite.close();
  Reflect.deleteProperty(globalThis, "requestAnimationFrame");
  Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
});

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const cancellationSnapshot = (stopped = false) => ({
  status: stopped ? "cancelled" : "running",
  hasOlder: false,
  cursor: "10",
  items: [{
    id: "user-1", turnId: "main", streamId: "user-1", lane: "answer",
    role: "user", kind: "text", content: "hello", status: "complete",
    revision: 1, seq: 1, timestamp: "2026-09-07T06:00:00.000Z",
    data: stopped ? { runStoppedAt: "2026-09-07T06:00:20.000Z" } : {},
  }],
});

test("an SSE authentication failure is terminal until a new session initializes", async () => {
  let snapshotCalls = 0;
  let subscribeCalls = 0;
  const errors: Error[] = [];
  const adapter = {
    async loadSnapshot() {
      snapshotCalls += 1;
      return { items: [], status: "idle", hasOlder: false };
    },
    async loadOlder() {
      return { items: [], hasOlder: false };
    },
    async *subscribe() {
      subscribeCalls += 1;
      throw Object.assign(new Error("expired"), { status: 401 });
    },
    async execute() {
      return { accepted: true };
    },
  };
  const controller = useConversation({
    conversationKey: () => "200",
    adapter: () => adapter,
    onConnectionChange: () => undefined,
    onStatusChange: () => undefined,
    onError: (error) => errors.push(error),
  });

  await controller.initialize();
  await delay(50);
  assert.equal(snapshotCalls, 1);
  assert.equal(subscribeCalls, 1);
  assert.equal(errors.length, 1);
  assert.equal(controller.state.value.connection.status, "error");

  await delay(900);
  assert.equal(snapshotCalls, 1);
  assert.equal(subscribeCalls, 1);

  await controller.initialize();
  await delay(50);
  assert.equal(snapshotCalls, 2);
  assert.equal(subscribeCalls, 2);
  controller.dispose();
});

test("answer settlement restarts the SSE epoch before reseeding snapshot versions", async () => {
  let snapshotCalls = 0;
  let subscribeCalls = 0;
  let firstSubscriptionAborted = false;
  const adapter = {
    async loadSnapshot() {
      snapshotCalls += 1;
      return { items: [], status: "idle", hasOlder: false, cursor: "40" };
    },
    async loadOlder() {
      return { items: [], hasOlder: false };
    },
    async *subscribe(request: { signal: AbortSignal }) {
      subscribeCalls += 1;
      const call = subscribeCalls;
      try {
        if (call === 1) {
          yield {
          protocolVersion: 2,
          conversationKey: "201",
          eventId: "answer-41-r1",
          cursor: "41",
          turnId: "main",
          streamId: "msg-41",
          lane: "answer",
          seq: 1,
          revision: 1,
          timestamp: "2026-08-27T15:00:00.000Z",
          type: "item.upsert",
          item: {
            id: "msg-41",
            turnId: "main",
            streamId: "msg-41",
            lane: "answer",
            role: "assistant",
            kind: "result",
            content: "done",
            status: "complete",
            revision: 1,
            seq: 1,
            timestamp: "2026-08-27T15:00:00.000Z",
          },
          };
        }
        await new Promise<void>((resolve) => {
          if (request.signal.aborted) {
            resolve();
            return;
          }
          request.signal.addEventListener("abort", () => resolve(), { once: true });
        });
      } finally {
        if (call === 1) firstSubscriptionAborted = true;
      }
    },
    async execute() {
      return { accepted: true };
    },
  };
  const controller = useConversation({
    conversationKey: () => "201",
    adapter: () => adapter,
    onConnectionChange: () => undefined,
    onStatusChange: () => undefined,
    onError: () => undefined,
  });

  await controller.initialize();
  await delay(250);
  assert.deepEqual(
    { firstSubscriptionAborted, snapshotCalls, subscribeCalls },
    { firstSubscriptionAborted: true, snapshotCalls: 2, subscribeCalls: 2 },
  );
  controller.dispose();
});

test("a stale initialize cannot subscribe before the current snapshot settles", async () => {
  let snapshotCalls = 0;
  let subscribeCalls = 0;
  const releases = new Map<number, () => void>();
  const adapter = {
    async loadSnapshot() {
      const call = ++snapshotCalls;
      await new Promise<void>((resolve) => releases.set(call, resolve));
      return { items: [], status: "idle", hasOlder: false, cursor: String(call) };
    },
    async loadOlder() {
      return { items: [], hasOlder: false };
    },
    async *subscribe(request: { signal: AbortSignal }) {
      subscribeCalls += 1;
      await new Promise<void>((resolve) => {
        if (request.signal.aborted) {
          resolve();
          return;
        }
        request.signal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
    async execute() {
      return { accepted: true };
    },
  };
  const controller = useConversation({
    conversationKey: () => "202",
    adapter: () => adapter,
    onConnectionChange: () => undefined,
    onStatusChange: () => undefined,
    onError: () => undefined,
  });

  const staleInitialize = controller.initialize();
  await delay(0);
  const currentInitialize = controller.initialize();
  await delay(0);
  releases.get(1)?.();
  await staleInitialize;
  assert.equal(subscribeCalls, 0);
  releases.get(2)?.();
  await currentInitialize;
  await delay(0);
  assert.equal(subscribeCalls, 1);
  controller.dispose();
});

test("stop cancels active items, aborts SSE, and disconnects locally", async () => {
  let subscriptionAborted = false;
  let stopped = false;
  const adapter = {
    async loadSnapshot() {
      return {
        status: stopped ? "cancelled" : "idle",
        hasOlder: false,
        cursor: "10",
        items: [{
          id: "thinking-1",
          turnId: "main",
          streamId: "thinking-1",
          lane: "process",
          role: "assistant",
          kind: "thinking",
          content: "正在处理…",
          status: stopped ? "cancelled" : "streaming",
          revision: 1,
          seq: 1,
          timestamp: "2026-08-27T15:00:00.000Z",
        }],
      };
    },
    async loadOlder() {
      return { items: [], hasOlder: false };
    },
    async *subscribe(request: { signal: AbortSignal }) {
      await new Promise<void>((resolve) => {
        if (request.signal.aborted) return resolve();
        request.signal.addEventListener("abort", () => {
          subscriptionAborted = true;
          resolve();
        }, { once: true });
      });
    },
    async execute(command: { type: string }) {
      assert.equal(command.type, "stop");
      stopped = true;
      return { accepted: true };
    },
  };
  const controller = useConversation({
    conversationKey: () => "203",
    adapter: () => adapter,
    onConnectionChange: () => undefined,
    onStatusChange: () => undefined,
    onError: () => undefined,
  });

  await controller.initialize();
  await delay(0);
  await controller.stop();
  await delay(0);

  assert.equal(controller.state.value.status, "cancelled");
  assert.equal(controller.state.value.items["thinking-1"]?.status, "cancelled");
  assert.equal(controller.state.value.connection.status, "disconnected");
  assert.equal(subscriptionAborted, true);
  controller.dispose();
});

test("only a 404 stop response is treated as idempotent success", () => {
  assert.equal(isIdempotentStopError(new ApiError("not running", "NOT_FOUND", 404)), true);
  assert.equal(isIdempotentStopError(new ApiError("server failed", "FAILED", 500)), false);
  assert.equal(isIdempotentStopError(new Error("network failed")), false);
});

test("stop reconciles its endpoint while an obsolete SSE snapshot is in flight", { timeout: 5_000 }, async () => {
  const refreshing = deferred<void>();
  const oldSnapshot = deferred<ReturnType<typeof cancellationSnapshot>>();
  let snapshotCalls = 0;
  const errors: Error[] = [];
  const adapter = {
    async loadSnapshot() {
      const call = ++snapshotCalls;
      if (call === 2) {
        refreshing.resolve();
        return oldSnapshot.promise;
      }
      return cancellationSnapshot(call > 2);
    },
    async *subscribe(request: { signal: AbortSignal }) {
      // A missing stream requests authoritative reconciliation without ending
      // the running turn. Keep that snapshot pending until stop has returned.
      yield {
        protocolVersion: 2, conversationKey: "205", eventId: "missing-1",
        cursor: "11", turnId: "main", streamId: "missing", lane: "process",
        revision: 1, seq: 1, timestamp: "2026-09-07T06:00:01.000Z",
        type: "stream.append", delta: "working",
      };
      if (!request.signal.aborted) {
        await new Promise<void>((resolve) => request.signal.addEventListener("abort", () => resolve(), { once: true }));
      }
    },
    async execute() { return { accepted: true }; },
  };
  const controller = useConversation({
    conversationKey: () => "205", adapter: () => adapter,
    onConnectionChange: () => undefined, onStatusChange: () => undefined,
    onError: (error: Error) => errors.push(error),
  });
  try {
    await controller.initialize();
    await refreshing.promise;
    await controller.stop();
    assert.equal(snapshotCalls, 3);
    assert.equal(controller.state.value.items["user-1"]?.data?.runStoppedAt, "2026-09-07T06:00:20.000Z");
    oldSnapshot.resolve(cancellationSnapshot());
    await delay(0);
    assert.equal(controller.state.value.status, "cancelled");
    assert.equal(controller.state.value.connection.status, "disconnected");
    assert.equal(controller.state.value.items["user-1"]?.data?.runStoppedAt, "2026-09-07T06:00:20.000Z");
    assert.deepEqual(errors, []);
  } finally {
    oldSnapshot.resolve(cancellationSnapshot());
    controller.dispose();
  }
});

test("a cancelled snapshot failure cannot report into a new conversation lifecycle", { timeout: 5_000 }, async () => {
  const refreshing = deferred<void>();
  const cancelledSnapshot = deferred<ReturnType<typeof cancellationSnapshot>>();
  let snapshotCalls = 0;
  let conversationKey = "206";
  const errors: Error[] = [];
  const adapter = {
    async loadSnapshot() {
      if (++snapshotCalls === 2) {
        refreshing.resolve();
        return cancelledSnapshot.promise;
      }
      return snapshotCalls === 1 ? cancellationSnapshot() : { items: [], status: "idle", hasOlder: false };
    },
    async *subscribe(request: { signal: AbortSignal }) {
      if (!request.signal.aborted) {
        await new Promise<void>((resolve) => request.signal.addEventListener("abort", () => resolve(), { once: true }));
      }
    },
    async execute() { return { accepted: true }; },
  };
  const controller = useConversation({
    conversationKey: () => conversationKey, adapter: () => adapter,
    onConnectionChange: () => undefined, onStatusChange: () => undefined,
    onError: (error: Error) => errors.push(error),
  });
  try {
    await controller.initialize();
    const stopping = controller.stop();
    await refreshing.promise;
    conversationKey = "207";
    await controller.initialize();
    cancelledSnapshot.reject(new Error("obsolete cancellation snapshot failed"));
    await stopping;
    assert.deepEqual(errors, []);
    assert.equal(controller.state.value.status, "idle");
    assert.equal(controller.state.value.connection.status, "connected");
    assert.deepEqual(controller.state.value.items, {});
  } finally {
    cancelledSnapshot.resolve(cancellationSnapshot(true));
    controller.dispose();
  }
});

test("stop is a no-op for an already completed snapshot", async () => {
  let executeCalls = 0;
  const adapter = {
    async loadSnapshot() {
      return { items: [], status: "completed", hasOlder: false, cursor: "20" };
    },
    async loadOlder() {
      return { items: [], hasOlder: false };
    },
    async *subscribe() {
      return;
    },
    async execute() {
      executeCalls += 1;
      return { accepted: true };
    },
  };
  const controller = useConversation({
    conversationKey: () => "204",
    adapter: () => adapter,
    onConnectionChange: () => undefined,
    onStatusChange: () => undefined,
    onError: () => undefined,
  });
  await controller.initialize();
  await controller.stop();
  assert.equal(executeCalls, 0);
  assert.equal(controller.state.value.status, "completed");
  controller.dispose();
});
