import assert from "node:assert/strict";
import test from "node:test";
import { fetchImageContent } from "../src/addons/conversation/api/imageContent.ts";

function runtime() {
  return {
    token: "fixture-token",
    version: 1,
    getAccessToken() { return this.token; },
    getSessionVersion() { return this.version; },
    handleUnauthorizedResponse() {},
  };
}

function response(headers: Record<string, string> = {}) {
  return new Response(new Uint8Array([255, 216, 255]), { headers: {
    "Content-Type": "image/jpeg", "Content-Length": "3",
    "Content-Disposition": 'attachment; filename="artifact-1.jpg"', ...headers,
  } });
}

test("images use authenticated Storage bytes and server filename, not signed CS URLs", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://storage.fixture/api/v1/files/old%2Fid/content");
    assert.equal(new Headers(init.headers).get("Authorization"), "fixture-token");
    assert.equal(new Headers(init.headers).get("X-Namespace"), "core");
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    return response();
  });
  const result = await fetchImageContent("https://storage.fixture/", "old/id", runtime());
  assert.equal(result.filename, "artifact-1.jpg");
  assert.equal(result.blob.type, "image/jpeg");
  assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), new Uint8Array([255, 216, 255]));
});

test("account switch rejects completed old responses", async (t) => {
  const session = runtime();
  t.mock.method(globalThis, "fetch", async () => {
    session.version++;
    session.token = "other";
    return response();
  });
  await assert.rejects(fetchImageContent("https://storage.fixture", "image", session), { name: "AbortError" });
});

test("abort reaches provider request and no fallback is attempted", async (t) => {
  let count = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    count++;
    init.signal?.throwIfAborted();
    return response();
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchImageContent("https://storage.fixture", "image", runtime(), controller.signal));
  assert.ok(count <= 1);
});

test("invalid MIME, missing filename and mismatched length fail closed", async (t) => {
  for (const headers of [
    { "Content-Type": "image/svg+xml" },
    { "Content-Disposition": 'attachment; filename="bad.html"' },
    { "Content-Disposition": 'attachment; filename="../bad.jpg"' },
    { "Content-Length": "4" },
    { "Content-Length": String(100 * 1024 * 1024 + 1) },
  ]) {
    const mock = t.mock.method(globalThis, "fetch", async () => response(headers));
    await assert.rejects(fetchImageContent("https://storage.fixture", "image", runtime()));
    mock.mock.restore();
  }
});

test("UTF-8 filename is preserved and unauthorized errors notify only current session", async (t) => {
  let rejected = 0;
  const session = { ...runtime(), handleUnauthorizedResponse(authorization?: string) {
    assert.equal(authorization, this.token);
    rejected++;
  } };
  const mock = t.mock.method(globalThis, "fetch", async () => response({
    "Content-Disposition": "attachment; filename*=utf-8''%E5%9B%BE%E7%89%87.jpg",
  }));
  assert.equal((await fetchImageContent("https://storage.fixture", "image", session)).filename, "图片.jpg");
  mock.mock.restore();
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 401 }));
  await assert.rejects(fetchImageContent("https://storage.fixture", "image", session));
  assert.equal(rejected, 1);
});

for (const interruption of ["none", "account", "cancel"] as const) {
  test(`streamed image ${interruption}: late bytes respect the captured session and cancellation`, { timeout: 5_000 }, async (t) => {
    const session = runtime();
    const controller = new AbortController();
    const waiting = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let reads = 0;
    let requests = 0;
    let cancelled = false;
    let requestSignal: AbortSignal | undefined;
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        if (reads === 2) {
          stream.close();
          return;
        }
        if (reads++ === 0) {
          stream.enqueue(new Uint8Array([255]));
          return;
        }
        waiting.resolve();
        await release.promise;
        stream.enqueue(new Uint8Array([216, 255]));
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
      requests++;
      requestSignal = init.signal!;
      return new Response(body, { headers: response().headers });
    });
    const pending = fetchImageContent("https://storage.fixture", "image", session, controller.signal);
    await waiting.promise;
    if (interruption === "account") {
      session.version++;
      session.token = "other";
    } else if (interruption === "cancel") {
      controller.abort();
    }
    release.resolve();
    if (interruption === "none") {
      const result = await pending;
      assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), new Uint8Array([255, 216, 255]));
      assert.equal(result.filename, "artifact-1.jpg");
      assert.equal(requestSignal?.aborted, false);
    } else {
      await assert.rejects(pending, { name: "AbortError" });
      assert.equal(requestSignal?.aborted, true);
    }
    assert.equal(body.locked, false);
    assert.equal(requests, 1);
    assert.equal(cancelled, interruption !== "none");
  });
}

test("late unauthorized image response cannot invalidate the replacement account", { timeout: 5_000 }, async (t) => {
  const waiting = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let unauthorized = 0;
  const session = { ...runtime(), handleUnauthorizedResponse() { unauthorized++; } };
  t.mock.method(globalThis, "fetch", async () => {
    waiting.resolve();
    await release.promise;
    return new Response("", { status: 401 });
  });
  const pending = fetchImageContent("https://storage.fixture", "image", session);
  await waiting.promise;
  session.token = "replacement";
  session.version++;
  release.resolve();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(unauthorized, 0);
});
