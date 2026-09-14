import assert from "node:assert/strict";
import { test } from "node:test";
import { createConversationNavigationCache } from "../src/addons/conversation/composables/conversationNavigationCache.ts";

const snapshot = (text = "hello") => ({ items: [{ id: "msg-1", turnId: "main", streamId: "msg-1", lane: "answer" as const, role: "user" as const, kind: "text", content: text, status: "complete" as const, revision: 1, seq: 1, timestamp: "2026-09-08T00:00:00Z" }], status: "running" as const, hasOlder: false });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(accept => { resolve = accept; }); return { promise, resolve }; };

test("concurrent detail consumers share only the in-flight request", async () => {
  const cache = createConversationNavigationCache(() => ({ token: "a", version: 1 }));
  const request = deferred<any>(); let calls = 0;
  const load = () => { calls++; return request.promise; };
  const model = cache.loadConversation("1", load);
  const backend = cache.loadConversation("1", load);
  const history = cache.loadConversation("1", load);
  assert.equal(calls, 1);
  request.resolve({ id: 1 });
  assert.deepEqual(await Promise.all([model, backend, history]), [{ id: 1 }, { id: 1 }, { id: 1 }]);
  await cache.loadConversation("1", load);
  assert.equal(calls, 2, "subsequent refresh must request authoritative state");
});

test("snapshot restoration is isolated by conversation, immutable, and bounded", () => {
  const cache = createConversationNavigationCache(() => ({ token: "a", version: 1 }), { maxEntries: 2 });
  const a = cache.forConversation("1"); const b = cache.forConversation("2");
  const original = snapshot("A"); a.write(original); b.write(snapshot("B")); original.items[0]!.content = "mutated";
  const restored = a.read()!;
  assert.equal(restored.items[0]!.content, "A"); restored.items[0]!.content = "changed";
  assert.equal(a.read()!.items[0]!.content, "A");
  cache.forConversation("3").write(snapshot("C"));
  assert.equal(b.read(), undefined); assert.equal(a.read()!.items[0]!.content, "A");
});

test("logout/account or authorization version changes retire old cache writers and requests", async () => {
  let session = { token: "a" as string | null, version: 1 };
  const cache = createConversationNavigationCache(() => session);
  const old = cache.forConversation("1"); old.write(snapshot("private"));
  const request = deferred<any>(); const pending = cache.loadConversation("1", () => request.promise);
  session = { token: "b", version: 2 };
  assert.equal(cache.forConversation("1").read(), undefined);
  old.write(snapshot("late"));
  assert.equal(cache.forConversation("1").read(), undefined);
  request.resolve({ id: 1 }); await assert.rejects(pending, { name: "AbortError" });
  cache.forConversation("1").write(snapshot("B"));
  session = { token: "b", version: 3 }; assert.equal(cache.forConversation("1").read(), undefined);
  const retired = cache.forConversation("1");
  session = { token: null, version: 4 }; retired.write(snapshot("late B"));
  assert.equal(cache.forConversation("1").read(), undefined);
  cache.forConversation("1").write(snapshot("anonymous"));
  assert.equal(cache.forConversation("1").read(), undefined);
});

test("failed requests can retry; superseded failures cannot leak into a new session", async () => {
  let session = { token: "a", version: 1 };
  const cache = createConversationNavigationCache(() => session);
  await assert.rejects(cache.loadConversation("1", () => Promise.reject(Error("offline"))), /offline/);
  assert.deepEqual(await cache.loadConversation("1", async () => ({ id: 1 }) as any), { id: 1 });
  const old = cache.loadConversation("2", async () => { session = { token: "b", version: 2 }; throw Error("private failure"); });
  await assert.rejects(old, { name: "AbortError" });
});

test("expiry, byte budget and explicit reset discard snapshots without admitting retired writers", () => {
  let now = 0;
  const cache = createConversationNavigationCache(() => ({ token: "a", version: 1 }), { now: () => now, ttlMs: 10, maxBytes: new TextEncoder().encode(JSON.stringify(snapshot())).byteLength + 32 });
  const a = cache.forConversation("1"); a.write(snapshot()); now = 11; assert.equal(a.read(), undefined);
  a.write(snapshot("x".repeat(1000))); assert.equal(a.read(), undefined);
  a.write(snapshot("A")); cache.forConversation("2").write(snapshot("B")); assert.equal(a.read(), undefined);
  cache.clear(); a.write(snapshot("retired")); assert.equal(cache.forConversation("1").read(), undefined);
});

test("denied access removes only its own conversation and retired denials cannot clear a new account", () => {
  let session = { token: "a", version: 1 };
  const cache = createConversationNavigationCache(() => session);
  const denied = cache.forConversation("1"); denied.write(snapshot("private"));
  const other = cache.forConversation("2"); other.write(snapshot("other"));
  denied.forget(); assert.equal(denied.read(), undefined); assert.equal(other.read()!.items[0]!.content, "other");
  session = { token: "b", version: 2 };
  const current = cache.forConversation("1"); current.write(snapshot("current"));
  denied.forget(); assert.equal(current.read()!.items[0]!.content, "current");
});

test("a live history exceeding the snapshot protocol limit is not cached or truncated", () => {
  const cache = createConversationNavigationCache(() => ({ token: "a", version: 1 }));
  const conversation = cache.forConversation("1");
  conversation.write(snapshot());
  conversation.write({ ...snapshot(), items: Array.from({ length: 201 }, () => snapshot().items[0]!) });
  assert.equal(conversation.read(), undefined);
});
