import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { AxiosError, isCancel } from "axios";
import { createServer, type ViteDevServer } from "vite";

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

before(async () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
  vite = await createServer({
    appType: "custom",
    optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  ({ default: http } = await vite.ssrLoadModule("/src/addons/platform-api/api/http.ts"));
  ({ handleEmbeddedUnauthorized, applyShellSession, setAuthRequiredNotifier } = await vite.ssrLoadModule(
    "/src/addons/platform-api/session/embeddedSession.ts",
  ));
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
  assert.equal(request.authorization(), "Bearer old-token");

  localStorage.setItem(ACCESS_TOKEN_KEY, "fresh-token");
  request.release();

  await assert.rejects(request.response, { name: "ApiError", status: 401 });
  assert.equal(localStorage.getItem(ACCESS_TOKEN_KEY), "fresh-token");
});

test("a 401 from the current token still invalidates that token", async () => {
  localStorage.setItem(ACCESS_TOKEN_KEY, "current-token");
  const request = deferredUnauthorizedRequest();
  await request.started;
  assert.equal(request.authorization(), "Bearer current-token");

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
