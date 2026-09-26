import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedHostOrigins,
  embedHostMessage,
  installEmbedHostHandshake,
} from "../src/composables/useEmbedHostHandshake.ts";
import * as token from "../src/utils/token.ts";

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

  const uninstall = installEmbedHostHandshake(HOST);
  const deliver = async (data: unknown, origin = HOST, source: unknown = parent) => {
    listener?.({ data, origin, source });
    // Let the exchange fetch and its continuation settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
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
