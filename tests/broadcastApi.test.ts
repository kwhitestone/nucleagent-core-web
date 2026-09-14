import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig } from "axios";
import { createServer, type ViteDevServer } from "vite";
import type {
  BroadcastCancelResult,
  BroadcastFollowUpRequest,
  BroadcastFollowUpResult,
  BroadcastGroupDetail,
  BroadcastRequest,
  BroadcastResult,
  Conversation,
} from "../src/addons/conversation/api/types.ts";

let vite: ViteDevServer;
let api: typeof import("../src/addons/conversation/api/broadcast.ts");
let unregister: () => void;
type Options = { signal?: AbortSignal; transformResponse?: AxiosRequestConfig["transformResponse"] };
let get: (url: string, options: Options) => Promise<unknown>;
let post: (url: string, body: unknown, options: Options) => Promise<unknown>;
const base = "/api/v1/addons/conversation/broadcast";
const envelope = (data: unknown) => ({ data: { code: 0, message: "ok", data } });
const conversation: Conversation = {
  id: 41, userId: 7, title: "Compare", mode: "a2a_agent", status: "executing",
  executionBackend: "codex", providerId: null, completedAt: null,
  createdAt: "2026-09-09T00:00:00Z", updatedAt: "2026-09-09T00:00:00Z",
  state: { broadcastGroupId: "group/one", retained: { enabled: true } },
};
const created: BroadcastResult = { groupId: "group/one", conversations: [conversation], skipped: null };
const followed: BroadcastFollowUpResult = {
  groupId: "group/one", outcomes: [{ conversationId: 41, backend: "codex", accepted: true }], skipped: null,
};
const cancelled: BroadcastCancelResult = { groupId: "group/one", cancelled: null, failed: [] };
const detail: BroadcastGroupDetail = {
  groupId: "group/one", siblings: [{
    id: 41, executionBackend: "codex", status: "completed", title: "Compare",
    createdAt: conversation.createdAt, completedAt: "2026-09-09T00:01:00Z",
  }],
};

before(async () => {
  vite = await createServer({
    appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime({
    http: {
      defaults: { transformResponse: axios.defaults.transformResponse },
      get: (url: string, options: Options) => get(url, options),
      post: (url: string, body: unknown, options: Options) => post(url, body, options),
    },
  });
  api = await vite.ssrLoadModule("/src/addons/conversation/api/broadcast.ts");
});
beforeEach(() => {
  get = async () => { throw new Error("Unexpected GET"); };
  post = async () => { throw new Error("Unexpected POST"); };
});
after(async () => { unregister?.(); await vite?.close(); });

test("create unwraps the Core envelope, retains state and forwards the body and abort signal", async () => {
  const scope = new AbortController();
  const payload: BroadcastRequest = {
    mode: "a2a_agent", input: "Compare", providerId: 2, model: "selected-model",
    executionBackends: ["codex", "hermes"], agentId: 5, projectId: 8,
    metadata: { format: "plain" }, attachments: [{ fileId: "file-1", name: "notes.txt" }],
  };
  Object.freeze(payload);
  post = async (url, body, options) => {
    assert.equal(url, base);
    assert.deepEqual(body, payload);
    assert.equal(options.signal, scope.signal);
    return envelope(created);
  };
  assert.deepEqual(await api.createBroadcast(payload, scope.signal), created);
});

test("get encodes group identity and preserves the sibling status projection", async () => {
  const scope = new AbortController();
  get = async (url, options) => {
    assert.equal(url, `${base}/group%2Fone`);
    assert.equal(options.signal, scope.signal);
    return envelope(detail);
  };
  assert.deepEqual(await api.getBroadcast("group/one", scope.signal), detail);
});

test("follow-up returns every accepted and skipped outcome without changing the payload", async () => {
  const scope = new AbortController();
  const payload: BroadcastFollowUpRequest = { input: "Continue", attachments: [{ fileId: "file-1" }] };
  const result: BroadcastFollowUpResult = {
    ...followed, outcomes: [...followed.outcomes, { conversationId: 42, backend: "hermes", accepted: false, reason: "busy" }],
    skipped: [{ backend: "hermes", reason: "busy" }],
  };
  post = async (url, body, options) => {
    assert.equal(url, `${base}/group%2Fone/follow-up`);
    assert.deepEqual(body, payload);
    assert.equal(options.signal, scope.signal);
    return envelope(result);
  };
  assert.deepEqual(await api.broadcastFollowUp("group/one", payload, scope.signal), result);
});

test("cancel accepts both a populated list and Go's null empty slice", async () => {
  const scope = new AbortController();
  for (const ids of [null, [], [41, 42]]) {
    post = async (url, body, options) => {
      assert.equal(url, `${base}/group%2Fone/cancel`);
      assert.equal(body, undefined);
      assert.equal(options.signal, scope.signal);
      return envelope({ ...cancelled, cancelled: ids });
    };
    assert.deepEqual(await api.broadcastCancel("group/one", scope.signal), { ...cancelled, cancelled: ids });
  }
});

test("create and follow-up preserve every backend skip reason", async () => {
  const skipped = [
    "offline", "model_required", "protocol_incompatible", "busy", "unavailable",
    "queue_full", "invalid_model", "invalid_attachment", "internal_error",
  ].map(reason => ({ backend: "hermes", reason }));
  post = async () => envelope({ ...created, skipped });
  assert.deepEqual((await api.createBroadcast({ mode: "a2a", input: "Compare" })).skipped, skipped);
  post = async () => envelope({ ...followed, skipped });
  assert.deepEqual((await api.broadcastFollowUp("group/one", { input: "Continue" })).skipped, skipped);
});

test("cancel preserves member failures alongside successful cancellations", async () => {
  const result: BroadcastCancelResult = {
    groupId: "group/one", cancelled: [41],
    failed: [{ conversationId: 42, backend: "hermes", reason: "internal_error" }],
  };
  post = async () => envelope(result);
  assert.deepEqual(await api.broadcastCancel("group/one"), result);
});

test("optional abort signals and nullable skipped lists work for both create and follow-up", async () => {
  for (const skipped of [null, [], [{ backend: "hermes", reason: "offline" as const }]]) {
    post = async (_url, _body, options) => {
      assert.equal(options.signal, undefined);
      return envelope({ ...created, skipped });
    };
    assert.deepEqual(await api.createBroadcast({ mode: "a2a", input: "Compare" }), { ...created, skipped });
    post = async () => envelope({ ...followed, skipped });
    assert.deepEqual(await api.broadcastFollowUp("group/one", { input: "Continue" }), { ...followed, skipped });
  }
  get = async () => envelope(detail);
  assert.deepEqual(await api.getBroadcast("group/one"), detail);
  post = async () => envelope(cancelled);
  assert.deepEqual(await api.broadcastCancel("group/one"), cancelled);
});

test("malformed or failed envelopes cannot masquerade as successful broadcasts", async () => {
  const calls = [
    () => api.createBroadcast({ mode: "a2a", input: "Compare" }),
    () => api.getBroadcast("group/one"),
    () => api.broadcastFollowUp("group/one", { input: "Continue" }),
    () => api.broadcastCancel("group/one"),
  ];
  for (const call of calls) {
    for (const body of [{}, { code: 0 }, { code: 0, data: null }, { code: 1, message: "denied", data: created }]) {
      get = post = async () => ({ data: body });
      await assert.rejects(call(), { name: "ApiError" });
    }
  }
  for (const [call, payload] of [
    [calls[0], { ...created, skipped: [{ backend: "hermes", reason: 5 }] }],
    [calls[0], { ...created, conversations: [{ ...conversation, state: "wrong" }] }],
    [calls[1], { ...detail, siblings: [{ ...detail.siblings[0], id: "41" }] }],
    [calls[2], { ...followed, outcomes: [{ conversationId: 41, backend: "codex", accepted: "true" }] }],
    [calls[3], { ...cancelled, cancelled: ["41"] }],
    [calls[3], { ...cancelled, failed: [{ conversationId: "42", backend: "hermes", reason: "busy" }] }],
    [calls[3], { ...cancelled, failed: [{ conversationId: 42, backend: "hermes", reason: "unknown" }] }],
  ] as const) {
    get = post = async () => envelope(payload);
    await assert.rejects(call(), { name: "ApiError", code: "INVALID_RESPONSE" });
  }
});

test("HTTP authorization, conflict and abort errors retain their identity", async () => {
  const { ApiError } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  for (const error of [
    new ApiError("denied", "FORBIDDEN", 403),
    new ApiError("busy", "CONFLICT", 409),
    new DOMException("Cancelled", "AbortError"),
  ]) {
    get = post = async () => { throw error; };
    await assert.rejects(api.getBroadcast("group/one"), caught => caught === error);
    await assert.rejects(api.createBroadcast({ mode: "a2a", input: "Compare" }), caught => caught === error);
    await assert.rejects(api.broadcastFollowUp("group/one", { input: "Continue" }), caught => caught === error);
    await assert.rejects(api.broadcastCancel("group/one"), caught => caught === error);
  }
});

test("already aborted calls never dispatch and late responses remain aborted", async () => {
  for (const call of [
    (signal: AbortSignal) => api.createBroadcast({ mode: "a2a", input: "Compare" }, signal),
    (signal: AbortSignal) => api.getBroadcast("group/one", signal),
    (signal: AbortSignal) => api.broadcastFollowUp("group/one", { input: "Continue" }, signal),
    (signal: AbortSignal) => api.broadcastCancel("group/one", signal),
  ]) {
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(call(aborted.signal), { name: "AbortError" });
    const late = new AbortController();
    get = post = async () => { late.abort(); return envelope(created); };
    await assert.rejects(call(late.signal), { name: "AbortError" });
  }
});

test("complete rejection retains validated member details after the real HTTP interceptor normalizes errors", async () => {
  const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });
  const { default: http }: { default: AxiosInstance } = await vite.ssrLoadModule("/src/addons/platform-api/api/http.ts");
  const originalAdapter = http.defaults.adapter;
  post = (url, body, options) => http.post(url, body, options);
  const scenarios = [
    {
      call: () => api.createBroadcast({ mode: "a2a", input: "Compare" }), status: 400,
      details: { skipped: [{ backend: "hermes", reason: "invalid_model" }] },
    },
    {
      call: () => api.broadcastFollowUp("group/one", { input: "Continue" }), status: 429,
      details: {
        skipped: [{ backend: "codex", reason: "queue_full" }],
        outcomes: [{ conversationId: 41, backend: "codex", accepted: false, reason: "queue_full" }],
      },
    },
    {
      call: () => api.broadcastCancel("group/one"), status: 500,
      details: { failed: [{ conversationId: 41, backend: "codex", reason: "internal_error" }] },
    },
  ];
  try {
    for (const { call, status, details } of scenarios) {
      http.defaults.adapter = async config => {
        throw new AxiosError("HTTP failure", AxiosError.ERR_BAD_RESPONSE, config, undefined, {
          config, status, statusText: "Rejected", headers: {},
          data: JSON.stringify({ status, detail: "Broadcast rejected", ...details, internal: "not exposed" }),
        });
      };
      await assert.rejects(call(), error => {
        assert.ok(error instanceof api.BroadcastApiError);
        assert.equal(error.status, status);
        assert.equal(error.message, "Broadcast rejected");
        assert.deepEqual(error.details, details);
        return true;
      });
    }
  } finally {
    http.defaults.adapter = originalAdapter;
    if (storage) Object.defineProperty(globalThis, "localStorage", storage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("problem preservation does not bypass authorization handling or accept malformed member details", async () => {
  const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let token: string | null = "broadcast-test";
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true, value: { getItem: () => token, removeItem: () => { token = null; } },
  });
  const { default: http }: { default: AxiosInstance } = await vite.ssrLoadModule("/src/addons/platform-api/api/http.ts");
  const originalAdapter = http.defaults.adapter;
  post = (url, body, options) => http.post(url, body, options);
  try {
    for (const [status, details] of [
      [401, { skipped: [{ backend: "codex", reason: "busy" }] }],
      [403, { skipped: [{ backend: "codex", reason: "busy" }] }],
      [409, { skipped: [{ backend: "codex", reason: "unknown" }] }],
      [409, { outcomes: [{ conversationId: "41", backend: "codex", accepted: false }] }],
      [500, { failed: [{ conversationId: 41, backend: "codex", reason: 12 }] }],
    ] as const) {
      http.defaults.adapter = async config => {
        throw new AxiosError("HTTP failure", AxiosError.ERR_BAD_RESPONSE, config, undefined, {
          config, status, statusText: "Rejected", headers: {}, data: { detail: "Rejected", ...details },
        });
      };
      await assert.rejects(api.broadcastFollowUp("group/one", { input: "Continue" }), error => {
        assert.equal((error as Error).name, "ApiError");
        assert.equal((error as { status: number }).status, status);
        assert.equal("details" in (error as object), false);
        return true;
      });
    }
    assert.equal(token, null, "the shared interceptor still invalidates the current unauthorized token");
  } finally {
    http.defaults.adapter = originalAdapter;
    if (storage) Object.defineProperty(globalThis, "localStorage", storage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
