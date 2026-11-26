import assert from "node:assert/strict";
import test, { before } from "node:test";

import {
  allowedHostOrigins,
  embedHostMessage,
  installEmbedHostHandshake,
} from "../src/composables/useEmbedHostHandshake.ts";
import * as token from "../src/utils/token.ts";
import { loadRuntimeConfig } from "../src/runtimeConfig.ts";
import { runtimeFixture } from "./fixtures/runtimeConfig.ts";

before(async () => {
  const fixture = runtimeFixture("sdp.ndaeweb.com");
  await loadRuntimeConfig("https://nucleagent-core-web.new.ndhy.com",
    (async () => new Response(JSON.stringify(fixture))) as typeof fetch);
});

const HOST = "http://localhost:19002";

test("accepts only well-formed host messages", () => {
  assert.deepEqual(
    embedHostMessage({ type: "agentia:embed-init", payload: { conversationId: "7" } }),
    { kind: "init", conversationId: "7" },
  );
  assert.deepEqual(
    embedHostMessage({ type: "agentia:embed-credential", payload: { conversationId: "7", ucToken: "uc" } }),
    { kind: "credential", conversationId: "7", ucToken: "uc" },
  );
  assert.deepEqual(
    embedHostMessage({ type: "agentia:embed-revoke", payload: { conversationId: "7", reason: "logout" } }),
    { kind: "revoke", conversationId: "7" },
  );
  // A credential message without a credential is not a credential message.
  assert.equal(
    embedHostMessage({ type: "agentia:embed-credential", payload: { conversationId: "7" } }),
    null,
  );
  assert.equal(
    embedHostMessage({ type: "nucleagent:ready", payload: { conversationId: "7" } }),
    null,
  );
  assert.equal(
    embedHostMessage({ type: "agentia:embed-init", payload: { conversationId: "  " } }),
    null,
  );
  assert.equal(embedHostMessage({ type: "agentia:embed-init" }), null);
  assert.equal(embedHostMessage(null), null);
});

test("host origins stay exact and drop malformed entries", () => {
  const origins = allowedHostOrigins("http://localhost:19002/, not-a-url, https://app.test");
  assert.deepEqual([...origins].sort(), ["http://localhost:19002", "https://app.test"]);
  assert.equal(allowedHostOrigins(undefined).size, 0);
  assert.equal(allowedHostOrigins("").size, 0);
});

/**
 * Drive the installed listener like a real embed: fake parent window, fake
 * fetch, fake localStorage. `deliver` plays one host message and settles the
 * exchange promise chain before returning.
 */
function embedded(
  run: (harness: {
    deliver: (data: unknown, origin?: string, source?: unknown) => Promise<void>;
    sent: { type: string; payload: Record<string, unknown> }[];
    targets: string[];
    calls: { url: string; init: RequestInit }[];
    respond: (value: { ok: boolean; body?: unknown }) => void;
    sessionEvents: boolean[];
  }) => Promise<void>,
  startConversation?: (request: { input: string; gen?: "image" | "video" }) => Promise<string>,
  configured = HOST,
): Promise<void> {
  const sent: { type: string; payload: Record<string, unknown> }[] = [];
  const targets: string[] = [];
  const calls: { url: string; init: RequestInit }[] = [];
  const sessionEvents: boolean[] = [];
  let response: { ok: boolean; body?: unknown } = { ok: true, body: { accessToken: "core-jwt" } };
  let listener: ((event: unknown) => void) | undefined;

  const parent = {
    postMessage: (data: { type: string; payload: Record<string, unknown> }, origin: string) => {
      sent.push(data);
      targets.push(origin);
    },
  };
  const values = new Map<string, string>();
  const saved = ["window", "localStorage", "fetch", "CustomEvent"].map((key) =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);

  Object.defineProperty(globalThis, "CustomEvent", {
    configurable: true,
    value: function CustomEvent(type: string, init?: { detail?: unknown }) {
      return { type, init };
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      parent,
      addEventListener: (_type: string, handler: (event: unknown) => void) => { listener = handler; },
      removeEventListener: () => { listener = undefined; },
      dispatchEvent: (event: { init?: { detail?: { authenticated?: boolean } } }) => {
        sessionEvents.push(Boolean(event.init?.detail?.authenticated));
        return true;
      },
    },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: response.ok, json: async () => response.body };
    },
  });

  const uninstall = installEmbedHostHandshake(configured, startConversation);
  const deliver = async (data: unknown, origin = HOST, source: unknown = parent) => {
    listener?.({ data, origin, source });
    // Let the exchange fetch and its continuation settle.
    await new Promise<void>((resolve) => setImmediate(resolve));
  };

  return run({
    deliver,
    sent,
    targets,
    calls,
    respond: (value) => { response = value; },
    sessionEvents,
  }).finally(() => {
    uninstall();
    token.clearAccessToken();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
}

const init = { type: "agentia:embed-init", payload: { conversationId: "7" } };
const credential = { type: "agentia:embed-credential", payload: { conversationId: "7", ucToken: "uc-secret" } };

test("a credential for the handshaked conversation is exchanged and releases the session", () =>
  embedded(async ({ deliver, sent, targets, calls, sessionEvents }) => {
    await deliver(init);
    await deliver(credential);

    assert.equal(calls.length, 1);
    // UNI PR-7: auth's portal handoff, credential in the JSON body only, and
    // cookie-only so the refresh credential never reaches this iframe origin.
    assert.match(calls[0].url, /\/api\/v1\/addons\/auth\/portal\/credential$/);
    assert.equal(new URL(calls[0].url).origin, "https://nucleagent-auth.new.ndhy.com");
    assert.equal(calls[0].init.body, JSON.stringify({ credential: "uc-secret" }));
    assert.equal(calls[0].init.credentials, "include");
    assert.equal((calls[0].init.headers as Record<string, string>)["X-Refresh-Cookie-Only"], "1");
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, undefined);
    assert.doesNotMatch(calls[0].url, /uc-secret|\?/);
    assert.equal(token.getAccessToken(), "core-jwt");
    assert.deepEqual(sessionEvents, [true]);
    assert.deepEqual(sent[1], {
      type: "nucleagent:credential-ack",
      payload: { conversationId: "7", status: "ok" },
    });
    // Never a wildcard target.
    assert.deepEqual([...new Set(targets)], [HOST]);
  }));

test("accepts auth's login envelope as well as the flat body", () =>
  embedded(async ({ deliver, respond }) => {
    respond({ ok: true, body: { message: "success", data: { accessToken: "enveloped", refreshToken: "", expiresIn: 900 } } });
    await deliver(init);
    await deliver(credential);
    assert.equal(token.getAccessToken(), "enveloped");
  }));

test("an untrusted origin or window never reaches the exchange", () =>
  embedded(async ({ deliver, sent, calls }) => {
    await deliver(init);
    await deliver(credential, "http://evil.test");
    await deliver(credential, HOST, { other: true });
    assert.equal(calls.length, 0);
    assert.equal(token.getAccessToken(), "");
    assert.equal(sent.length, 1); // only the ready reply
  }));

test("a credential for another conversation is dropped without an ack", () =>
  embedded(async ({ deliver, sent, calls }) => {
    await deliver(init);
    await deliver({ type: "agentia:embed-credential", payload: { conversationId: "9", ucToken: "uc" } });
    assert.equal(calls.length, 0);
    assert.equal(sent.length, 1);
  }));

test("a credential before the handshake is dropped", () =>
  embedded(async ({ deliver, sent, calls }) => {
    await deliver(credential);
    assert.equal(calls.length, 0);
    assert.equal(sent.length, 0);
  }));

test("a failed exchange is rejected without releasing the session", () =>
  embedded(async ({ deliver, sent, respond, sessionEvents }) => {
    respond({ ok: false });
    await deliver(init);
    await deliver(credential);
    assert.equal(token.getAccessToken(), "");
    assert.deepEqual(sessionEvents, []);
    assert.deepEqual(sent[1], {
      type: "nucleagent:credential-ack",
      payload: { conversationId: "7", status: "rejected" },
    });
  }));

test("a network or CORS failure is rejected like a refused credential", () =>
  embedded(async ({ deliver, sent, sessionEvents }) => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
    try {
      await deliver(init);
      await deliver(credential);
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(token.getAccessToken(), "");
    assert.deepEqual(sessionEvents, []);
    assert.equal(sent[1].payload.status, "rejected");
  }));

test("revoke clears the local credential and retires the server family", () =>
  embedded(async ({ deliver, calls, sessionEvents }) => {
    await deliver(init);
    await deliver(credential);
    await deliver({ type: "agentia:embed-revoke", payload: { conversationId: "7", reason: "logout" } });

    assert.equal(token.getAccessToken(), "");
    assert.deepEqual(sessionEvents, [true, false]);
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /\/api\/v1\/addons\/auth\/logout$/);
    assert.equal(calls[1].init.credentials, "include");
    assert.equal((calls[1].init.headers as Record<string, string>)["X-Refresh-Cookie-Only"], "1");
    assert.equal(
      (calls[1].init.headers as Record<string, string>).Authorization,
      "core-jwt",
    );
  }));

test("a revoke for another conversation leaves the session alone", () =>
  embedded(async ({ deliver, calls }) => {
    await deliver(init);
    await deliver(credential);
    await deliver({ type: "agentia:embed-revoke", payload: { conversationId: "9", reason: "logout" } });
    assert.equal(token.getAccessToken(), "core-jwt");
    assert.equal(calls.length, 1);
  }));

const start = { type: "agentia:embed-start", payload: { conversationId: "task-7", input: "hello" } };
const taskInit = { type: "agentia:embed-init", payload: { conversationId: "task-7" } };
const taskCredential = { type: "agentia:embed-credential", payload: { conversationId: "task-7", ucToken: "fixture-credential" } };

test("start requires ack, matching init, trusted origin and parent", () => {
  const requests: unknown[] = [];
  return embedded(async ({ deliver, sent }) => {
    await deliver(taskInit);
    await deliver(start);
    assert.equal(requests.length, 0);
    await deliver(taskCredential);
    await deliver({ ...start, payload: { ...start.payload, conversationId: "task-8" } });
    await deliver(start, "https://untrusted.test");
    await deliver(start, HOST, {});
    assert.equal(requests.length, 0);
    assert.equal(sent.length, 2);
    await deliver(start);
    assert.deepEqual(requests, [{ input: "hello" }]);
    assert.deepEqual(sent.at(-1), { type: "nucleagent:conversation-created", payload: { conversationId: "task-7", createdConversationId: "42" } });
  }, async (request) => { requests.push(request); return "42"; });
});

test("concurrent and repeated starts create once per frame, including repeated init", () => {
  let creates = 0;
  let complete!: (id: string) => void;
  return embedded(async ({ deliver, sent }) => {
    await deliver(taskInit);
    await deliver(taskCredential);
    await Promise.all([deliver(start), deliver(start)]);
    assert.equal(creates, 1);
    complete("42");
    await deliver(taskInit);
    await deliver(taskCredential);
    await deliver(start);
    assert.equal(creates, 1);
    assert.equal(sent.filter((message) => message.type === "nucleagent:conversation-created").length, 1);
  }, () => { creates++; return new Promise((resolve) => { complete = resolve; }); });
});

test("empty configuration ignores the whole protocol", () => {
  let creates = 0;
  return embedded(async ({ deliver, sent, calls }) => {
    await deliver(taskInit);
    await deliver(taskCredential);
    await deliver(start);
    assert.equal(creates, 0);
    assert.deepEqual(sent, []);
    assert.deepEqual(calls, []);
  }, async () => { creates++; return "42"; }, "");
});

test("image start passes the generation kind", () => {
  const requests: unknown[] = [];
  return embedded(async ({ deliver }) => {
    await deliver(taskInit);
    await deliver(taskCredential);
    await deliver({ ...start, payload: { ...start.payload, gen: "image" } });
    assert.deepEqual(requests, [{ input: "hello", gen: "image" }]);
  }, async (request) => { requests.push(request); return "43"; });
});

test("failed start replies with a fixed code without input or exception and cannot retry", () => {
  let creates = 0;
  return embedded(async ({ deliver, sent }) => {
    await deliver(taskInit);
    await deliver(taskCredential);
    await deliver(start);
    await deliver(start);
    assert.equal(creates, 1);
    assert.deepEqual(sent.at(-1), { type: "nucleagent:start-failed", payload: { conversationId: "task-7", code: "START_FAILED" } });
    assert.doesNotMatch(JSON.stringify(sent), /hello|private-error|fixture-credential/);
  }, async () => { creates++; throw new Error("private-error hello fixture-credential"); });
});

test("start validates task id, input and optional generation kind", () => {
  for (const payload of [
    { conversationId: "7", input: "hello" },
    { conversationId: "task-7", input: "" },
    { conversationId: "task-7", input: "   " },
    { conversationId: "task-7", input: "x".repeat(2001) },
    { conversationId: "task-7", input: 12 },
    { conversationId: "task-7", input: "hello", gen: "audio" },
  ]) assert.equal(embedHostMessage({ type: "agentia:embed-start", payload }), null);
  assert.deepEqual(embedHostMessage(start), { kind: "start", conversationId: "task-7", input: "hello" });
});

test("rejected credentials and revocation do not authorize start", () => {
  let creates = 0;
  return embedded(async ({ deliver, respond }) => {
    await deliver(taskInit);
    respond({ ok: false });
    await deliver(taskCredential);
    await deliver(start);
    respond({ ok: true, body: { accessToken: "fixture-session" } });
    await deliver(taskCredential);
    await deliver({ type: "agentia:embed-revoke", payload: { conversationId: "task-7" } });
    await deliver(start);
    assert.equal(creates, 0);
  }, async () => { creates++; return "42"; });
});

test("revocation invalidates an in-flight credential exchange", () =>
  embedded(async ({ deliver, sent }) => {
    let finish!: (response: Response) => void;
    globalThis.fetch = () => new Promise((resolve) => { finish = resolve; });
    await deliver(taskInit);
    await deliver(taskCredential);
    await deliver({ type: "agentia:embed-revoke", payload: { conversationId: "task-7" } });
    finish(new Response(JSON.stringify({ accessToken: "stale-session" })));
    await deliver(start);
    assert.equal(token.getAccessToken(), "");
    assert.deepEqual(sent.map((message) => message.type), ["nucleagent:ready"]);
  }, async () => { assert.fail("revoked session must not start"); }));

test("standalone visits install no host listener even with configured origins", () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "window");
  const standalone = { parent: null as unknown, addEventListener: () => assert.fail("standalone listener") };
  standalone.parent = standalone;
  Object.defineProperty(globalThis, "window", { configurable: true, value: standalone });
  try {
    installEmbedHostHandshake(HOST, async () => { assert.fail("standalone creation"); })();
  } finally {
    if (saved) Object.defineProperty(globalThis, "window", saved);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
