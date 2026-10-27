import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryHistory, createRouter, isNavigationFailure, NavigationFailureType } from "vue-router";

import { reportStartupFailure } from "../src/bootFailure.ts";

// MUYU-163: only the expected outcome of an anonymous redirect to the shell
// login — a vue-router ABORTED first navigation after the login URL was handed
// to the browser — is kept silent. Anything else is logged and bannered.

function fakeRoot() {
  const attrs: Record<string, string> = {};
  return { attrs, el: { textContent: "", setAttribute(k: string, v: string) { attrs[k] = v; } } as unknown as HTMLElement };
}

function report(error: unknown, configLoaded: boolean, leavingForLogin: boolean) {
  const root = fakeRoot();
  const logs: unknown[][] = [];
  reportStartupFailure(error, { configLoaded, leavingForLogin, root: root.el, log: (...a: unknown[]) => logs.push(a) });
  return { logs, banner: root.el.textContent ?? "", role: root.attrs.role };
}

/** The real startup path: a guard rejects the first navigation; isReady() rejects. */
async function firstNavigationRejection(guard: () => boolean | void): Promise<unknown> {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/", component: { template: "<div/>" }, meta: { requiresAuth: true } },
  ] });
  router.beforeEach(guard);
  void router.push("/").catch(() => {});
  try {
    await router.isReady();
    return undefined;
  } catch (error) {
    return error;
  }
}

test("real router: the auth guard's `return false` makes isReady() reject with an ABORTED failure", async () => {
  const error = await firstNavigationRejection(() => false);
  assert.ok(isNavigationFailure(error, NavigationFailureType.aborted), `got ${String(error)}`);
});

test("redirect handed to the browser + real ABORTED first navigation: silent, no banner", async () => {
  const r = report(await firstNavigationRejection(() => false), true, true);
  assert.deepEqual(r.logs, []);
  assert.equal(r.banner, "");
  assert.equal(r.role, undefined);
});

test("a real Error while the redirect is under way is still logged and bannered", () => {
  const r = report(new Error("Invalid plugin route path"), true, true);
  assert.equal(r.logs.length, 1);
  assert.match(String(r.logs[0][0]), /app mount/);
  assert.equal(r.role, "alert");
  assert.match(r.banner, /failed to start/);
});

test("an error thrown inside a guard (not an abort) is logged and bannered even after a redirect", async () => {
  const thrown = await firstNavigationRejection(() => { throw new Error("guard exploded"); });
  assert.ok(thrown instanceof Error && !isNavigationFailure(thrown));
  const r = report(thrown, true, true);
  assert.equal(r.logs.length, 1);
  assert.equal(r.role, "alert");
});

test("an ABORTED navigation with no login redirect (e.g. a guard inside the shell iframe) is logged", async () => {
  const r = report(await firstNavigationRejection(() => false), true, false);
  assert.equal(r.logs.length, 1);
  assert.equal(r.role, "alert");
});

test("cancelled or duplicated navigation failures are not mistaken for the login redirect", async () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/", component: { template: "<div/>" } },
    { path: "/a", component: { template: "<div/>" } },
    { path: "/b", component: { template: "<div/>" } },
  ] });
  await router.push("/");
  const duplicated = await router.push("/");
  let release!: () => void;
  const hold = new Promise<void>((r) => { release = r; });
  const remove = router.beforeEach((to) => (to.path === "/a" ? hold.then(() => true) : true));
  const slow = router.push("/a");
  await router.push("/b");
  release();
  const cancelled = await slow;
  remove();
  assert.ok(isNavigationFailure(duplicated, NavigationFailureType.duplicated));
  assert.ok(isNavigationFailure(cancelled, NavigationFailureType.cancelled));
  for (const failure of [duplicated, cancelled]) {
    assert.equal(report(failure, true, true).logs.length, 1);
  }
});

test("a runtime-config failure keeps its own wording, even if a redirect started", () => {
  const r = report(new Error("missing key"), false, true);
  assert.match(String(r.logs[0][0]), /runtime config/);
  assert.match(r.banner, /runtime configuration/);
});

function stubBrowser(assign: (href: string) => void, createElement?: () => unknown) {
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, window: g.window };
  const card = { hidden: false, className: "", innerHTML: "", setAttribute() {},
    querySelector: () => ({ textContent: "", href: "", hidden: true }) };
  g.document = { createElement: createElement ?? (() => card), body: { append() {} } };
  g.window = { location: { assign } };
  return () => { g.document = saved.document; g.window = saved.window; };
}

// Each case loads a fresh module instance so the one-shot flags start false.
const freshShellLogin = (tag: string) => import(`../src/addons/platform-api/shellLogin.ts?${tag}`);

test("isLeavingForLogin turns true only after location.assign() returned", async () => {
  const assigned: string[] = [];
  const restore = stubBrowser((href) => assigned.push(href));
  try {
    const shell = await freshShellLogin("ok");
    assert.equal(shell.isLeavingForLogin(), false);
    shell.redirectToShellLogin("https://shell.example.test", "/admin/conversations", { title: "t", body: "b" });
    assert.equal(shell.isLeavingForLogin(), true);
    assert.deepEqual(assigned, ["https://shell.example.test/login?redirect=%2Fadmin%2Fconversations"]);
  } finally { restore(); }
});

test("a throwing location.assign() leaves isLeavingForLogin false, so the failure is reported", async () => {
  const restore = stubBrowser(() => { throw new Error("navigation blocked"); });
  try {
    const shell = await freshShellLogin("assign");
    assert.throws(() => shell.redirectToShellLogin("https://shell.example.test", "/", { title: "t", body: "b" }), /navigation blocked/);
    assert.equal(shell.isLeavingForLogin(), false);
    const r = report(new Error("navigation blocked"), true, shell.isLeavingForLogin());
    assert.equal(r.logs.length, 1);
    assert.equal(r.role, "alert");
  } finally { restore(); }
});

test("a failure building the interstitial (DOM) or the URL leaves isLeavingForLogin false", async () => {
  const restore = stubBrowser(() => {}, () => { throw new Error("DOM unavailable"); });
  try {
    const shell = await freshShellLogin("dom");
    assert.throws(() => shell.redirectToShellLogin("https://shell.example.test", "/", { title: "t", body: "b" }), /DOM unavailable/);
    assert.equal(shell.isLeavingForLogin(), false);
  } finally { restore(); }
  const restore2 = stubBrowser(() => {});
  try {
    const shell = await freshShellLogin("url");
    assert.throws(() => shell.redirectToShellLogin("not a url", "/", { title: "t", body: "b" }));
    assert.equal(shell.isLeavingForLogin(), false);
  } finally { restore2(); }
});
