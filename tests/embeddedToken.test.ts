import assert from "node:assert/strict";
import test from "node:test";
import * as token from "../src/utils/token.ts";

test("iframe ignores persisted credentials until its verified host supplies a token", () => {
  const values = new Map([["nucleagent_access_token", "stale-other-session"]]);
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { parent: {} } });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  try {
    assert.equal(token.getAccessToken(), "");
    assert.equal(typeof token.setAccessToken, "function");
    token.setAccessToken("current-host-token");
    assert.equal(token.getAccessToken(), "current-host-token");
    assert.equal(values.has("nucleagent_access_token"), false);
    token.clearAccessToken();
    assert.equal(token.getAccessToken(), "");
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
