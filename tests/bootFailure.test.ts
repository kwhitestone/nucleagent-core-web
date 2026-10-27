import assert from "node:assert/strict";
import { test } from "node:test";

import { reportStartupFailure } from "../src/bootFailure.ts";

// MUYU-163: an anonymous visitor is sent to the shell login by the auth guard;
// the guard returns false, so router.isReady() rejects with NAVIGATION_ABORTED
// while the page is already leaving. That is not a startup failure: no error
// log, no alert banner. Real failures keep their log and banner.

function fakeRoot() {
  const attrs: Record<string, string> = {};
  return { attrs, el: { textContent: "", setAttribute(k: string, v: string) { attrs[k] = v; } } as unknown as HTMLElement };
}

const aborted = Object.assign(new Error("Navigation aborted"), { type: 4 });

test("leaving for the shell login: the aborted first navigation is neither logged nor bannered", () => {
  const root = fakeRoot();
  const logs: unknown[] = [];
  reportStartupFailure(aborted, { configLoaded: true, leavingForLogin: true, root: root.el, log: (...a: unknown[]) => logs.push(a) });
  assert.deepEqual(logs, []);
  assert.equal(root.el.textContent, "");
  assert.equal(root.attrs.role, undefined);
});

test("a real mount failure (not leaving) is still logged and bannered", () => {
  const root = fakeRoot();
  const logs: unknown[][] = [];
  reportStartupFailure(new Error("Invalid plugin route path"), { configLoaded: true, leavingForLogin: false, root: root.el, log: (...a: unknown[]) => logs.push(a) });
  assert.equal(logs.length, 1);
  assert.match(String(logs[0][0]), /app mount/);
  assert.equal(root.attrs.role, "alert");
  assert.match(root.el.textContent ?? "", /failed to start/);
});

test("a runtime-config failure keeps its own wording, even if a redirect started", () => {
  const root = fakeRoot();
  const logs: unknown[][] = [];
  reportStartupFailure(new Error("missing key"), { configLoaded: false, leavingForLogin: true, root: root.el, log: (...a: unknown[]) => logs.push(a) });
  assert.match(String(logs[0][0]), /runtime config/);
  assert.match(root.el.textContent ?? "", /runtime configuration/);
});

test("redirectToShellLogin marks the page as leaving before it navigates away", async () => {
  const appended: unknown[] = [];
  const assigned: string[] = [];
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, window: g.window };
  const card = { hidden: false, className: "", innerHTML: "", setAttribute() {},
    querySelector: () => ({ textContent: "", href: "", hidden: true }) };
  g.document = { createElement: () => card, body: { append: (x: unknown) => appended.push(x) } };
  g.window = { location: { assign: (href: string) => assigned.push(href) } };
  try {
    const shell = await import("../src/addons/platform-api/shellLogin.ts");
    assert.equal(shell.isLeavingForLogin(), false);
    shell.redirectToShellLogin("https://shell.example.test", "/admin/conversations", { title: "t", body: "b" });
    assert.equal(shell.isLeavingForLogin(), true);
    assert.deepEqual(assigned, ["https://shell.example.test/login?redirect=%2Fadmin%2Fconversations"]);
  } finally {
    g.document = saved.document;
    g.window = saved.window;
  }
});
