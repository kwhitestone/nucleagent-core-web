import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import axios, { AxiosError, isCancel } from "axios";
import { createServer, type ViteDevServer } from "vite";
import { runtimeFixture } from "./fixtures/runtimeConfig.ts";

const ACCESS_TOKEN_KEY = "nucleagent_access_token";

class MemoryStorage {
  readonly #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }
}

type HttpClient = Awaited<ReturnType<ViteDevServer["ssrLoadModule"]>>["default"];

let vite: ViteDevServer;
let http: HttpClient;
let handleEmbeddedUnauthorized: (reason: "missing" | "rejected") => void;
let applyShellSession: (token: string | null, version: number) => unknown;
let setAuthRequiredNotifier: (notifier: ((payload: unknown) => boolean) | undefined) => void;
let apiBase: () => string;
let authHeaders: () => Record<string, string>;

before(async () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
  vite = await createServer({
    appType: "custom",
    optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  const runtime = await vite.ssrLoadModule("/src/runtimeConfig.ts");
  const fixture = runtimeFixture("sdp.ndaeweb.com");
  await runtime.loadRuntimeConfig("https://nucleagent-core-web.new.ndhy.com",
    async () => new Response(JSON.stringify(fixture)));
  ({ default: http, apiBase, authHeaders } = await vite.ssrLoadModule("/src/addons/platform-api/api/http.ts"));
  ({ handleEmbeddedUnauthorized, applyShellSession, setAuthRequiredNotifier } = await vite.ssrLoadModule(
    "/src/addons/platform-api/session/embeddedSession.ts",
  ));
});

test("outer Core API keeps the current user's identity on the existing transport", async () => {
  localStorage.setItem(ACCESS_TOKEN_KEY, "synthetic-current-user");
  http.defaults.adapter = async (config: any) => {
    assert.equal(config.baseURL, "https://nucleagent-core-web.new.ndhy.com");
    assert.equal(config.headers.get("Authorization"), "synthetic-current-user");
    assert.equal(config.headers.get("X-API-Key"), undefined);
    return { config, data: { userId: "fixture-user" }, headers: {}, status: 200, statusText: "OK" };
  };
  assert.deepEqual((await http.get("/api/v1/addons/auth/user-info")).data, { userId: "fixture-user" });
  assert.equal(apiBase(), "https://nucleagent-core-web.new.ndhy.com");
  assert.equal(authHeaders().Authorization, "synthetic-current-user");
});

test("outer Storage uses the current identity without leaking it to presigned byte uploads", async () => {
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  const unregister = registerPlatformRuntime({ getAccessToken: () => localStorage.getItem(ACCESS_TOKEN_KEY) });
  const previousAdapter = axios.defaults.adapter;
  const requests: string[] = [];
  const byteHeaders: Record<string, string> = {};
  localStorage.setItem(ACCESS_TOKEN_KEY, "synthetic-storage-user");
  axios.defaults.adapter = async config => {
    assert.equal(config.baseURL, "https://nucleagent-storage.new.ndhy.com");
    assert.equal(config.headers.get("Authorization"), "synthetic-storage-user");
    assert.equal(config.headers.get("X-Namespace"), "core");
    assert.equal(config.headers.get("X-API-Key"), undefined);
    requests.push(config.url!);
    const data = config.url!.endsWith("/download") ? { url: "https://files.example.test/file" } :
      config.url!.endsWith("/presign") ? {
        fileId: "fixture-file", method: "PUT", uploadUrl: "https://files.example.test/upload",
        headers: { "Content-Type": "text/plain" }, expiresAt: 1,
      } : { fileId: "fixture-file", status: "active" };
    return { config, data: { data }, headers: {}, status: 200, statusText: "OK" };
  };
  class UploadRequest {
    status = 200;
    responseText = "{}";
    onload = () => {};
    open(method: string, url: string) {
      assert.equal(method, "PUT");
      assert.equal(url, "https://files.example.test/upload");
    }
    setRequestHeader(key: string, value: string) { byteHeaders[key] = value; }
    send() { this.onload(); }
  }
  Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: UploadRequest });
  try {
    const storage = await vite.ssrLoadModule("/src/addons/conversation/api/storage.ts");
    assert.equal(await storage.getDownloadUrl("fixture-file"), "https://files.example.test/file");
    await storage.uploadFile(new File(["fixture"], "file.txt", { type: "text/plain" }));
    assert.equal(requests.length, 3);
    assert.deepEqual(byteHeaders, { "Content-Type": "text/plain" });
    assert.doesNotMatch(JSON.stringify(byteHeaders), /synthetic-storage-user|Authorization/);
  } finally {
    axios.defaults.adapter = previousAdapter;
    unregister();
    Reflect.deleteProperty(globalThis, "XMLHttpRequest");
  }
});

beforeEach(() => {
  localStorage.clear();
});

after(async () => {
  await vite.close();
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "localStorage");
});

function deferredUnauthorizedRequest() {
  let release!: () => void;
  let adapterStarted!: () => void;
  let authorization: unknown;
  const releaseGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    adapterStarted = resolve;
  });

  http.defaults.adapter = async (config: Parameters<typeof http.defaults.adapter>[0]) => {
    authorization = config.headers.get("Authorization");
    adapterStarted();
    await releaseGate;
    throw new AxiosError("Unauthorized", AxiosError.ERR_BAD_REQUEST, config, undefined, {
      config,
      data: { code: "UNAUTHORIZED", message: "Unauthorized" },
      headers: {},
      status: 401,
      statusText: "Unauthorized",
    });
  };

  const response = http.get("/auth-race");
  return {
    authorization: () => authorization,
    release,
    response,
    started,
  };
}

test("a delayed pre-auth 401 cannot erase a synchronized token", async () => {
  const request = deferredUnauthorizedRequest();
  await request.started;
  assert.equal(request.authorization(), undefined);

  localStorage.setItem(ACCESS_TOKEN_KEY, "fresh-token");
  request.release();

  await assert.rejects(request.response, { name: "ApiError", status: 401 });
  assert.equal(localStorage.getItem(ACCESS_TOKEN_KEY), "fresh-token");
});

test("a delayed 401 from an older token cannot erase a refreshed token", async () => {
  localStorage.setItem(ACCESS_TOKEN_KEY, "old-token");
  const request = deferredUnauthorizedRequest();
  await request.started;
  assert.equal(request.authorization(), "old-token");

  localStorage.setItem(ACCESS_TOKEN_KEY, "fresh-token");
  request.release();

  await assert.rejects(request.response, { name: "ApiError", status: 401 });
  assert.equal(localStorage.getItem(ACCESS_TOKEN_KEY), "fresh-token");
});

test("a 401 from the current token still invalidates that token", async () => {
  localStorage.setItem(ACCESS_TOKEN_KEY, "current-token");
  const request = deferredUnauthorizedRequest();
  await request.started;
  assert.equal(request.authorization(), "current-token");

  request.release();

  await assert.rejects(request.response, { name: "ApiError", status: 401 });
  assert.equal(localStorage.getItem(ACCESS_TOKEN_KEY), null);
});

test("an embedded rejection sends one credential-free notification to the shell", () => {
  const messages: unknown[] = [];
  const parent = {};
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      parent,
      dispatchEvent() { return true; },
    },
  });
  setAuthRequiredNotifier((message) => {
    messages.push(message);
    return true;
  });
  applyShellSession("current-token", 7);

  handleEmbeddedUnauthorized("rejected");
  handleEmbeddedUnauthorized("rejected");

  assert.equal(localStorage.getItem(ACCESS_TOKEN_KEY), null);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0], {
    source: "sub",
    type: "auth-required",
    reason: "rejected",
    sessionVersion: 7,
  });
  assert.equal("token" in (messages[0] as Record<string, unknown>), false);
  setAuthRequiredNotifier(undefined);
  Reflect.deleteProperty(globalThis, "window");
});

function embeddedWindow(): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { parent: {}, dispatchEvent() { return true; } },
  });
}

test("embedded requests without a trusted session never reach the adapter", async () => {
  embeddedWindow();
  applyShellSession(null, 100);
  let requests = 0;
  http.defaults.adapter = async (config: unknown) => {
    requests++;
    return { config, data: {}, headers: {}, status: 200, statusText: "OK" };
  };
  try {
    await assert.rejects(http.get("/private"), isCancel);
    assert.equal(requests, 0);
  } finally { Reflect.deleteProperty(globalThis, "window"); }
});

test("logout cancels in-flight requests and a later session gets a fresh scope", async () => {
  embeddedWindow();
  applyShellSession("session-before-logout", 101);
  let release!: () => void;
  let started!: () => void;
  let requestSignal: AbortSignal | undefined;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  http.defaults.adapter = async (config: any) => {
    requestSignal = config.signal;
    started();
    await gate;
    return { config, data: {}, headers: {}, status: 200, statusText: "OK" };
  };
  const pending = http.get("/private").then(() => null, (error: unknown) => error);
  await ready;
  try {
    assert.equal(requestSignal?.aborted, false);
    applyShellSession(null, 102);
    assert.equal(requestSignal?.aborted, true);
  } finally { release(); }
  try {
    assert.ok(isCancel(await pending));
    applyShellSession("next-session", 103);
    await http.get("/private");
    assert.equal(requestSignal?.aborted, false);
    const caller = new AbortController();
    caller.abort();
    await assert.rejects(http.get("/private", { signal: caller.signal }), isCancel);
  } finally { Reflect.deleteProperty(globalThis, "window"); }
});

test("Huma problem details reach the caller with message precedence and bounded strings", async () => {
  for (const [body, expected] of [
    [{ message: "Safe envelope message", detail: "Secondary detail" }, "Safe envelope message"],
    [{ detail: "Configuration revision changed" }, "Configuration revision changed"],
    [{ message: "  ", detail: "  Worker is offline  " }, "Worker is offline"],
    [{ detail: " " }, "HTTP fixture failure"],
    [{ message: { invalid: true }, detail: 500 }, "HTTP fixture failure"],
    [{ detail: "x".repeat(2048) }, "x".repeat(1024)],
  ]) {
    http.defaults.adapter = async (config: any) => {
      throw new AxiosError("HTTP fixture failure", AxiosError.ERR_BAD_REQUEST, config, undefined, {
        config, data: body, headers: {}, status: 409, statusText: "Conflict",
      });
    };
    await assert.rejects(http.put("/api/v1/addons/admin/executors/fixture/runtime", {}), { name: "ApiError", status: 409, message: expected });
  }
});
