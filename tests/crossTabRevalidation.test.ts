import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let vite: any, session: any, token: any, auth: any;
let version = 100;
const events: any[] = [];
before(async () => {
  const window = Object.assign(new EventTarget(), { parent: {} });
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: () => null, setItem() {}, removeItem() {},
  } });
  window.addEventListener("nucleagent:session-change", (event: any) => events.push(event.detail));
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  session = await vite.ssrLoadModule("/src/addons/platform-api/session/embeddedSession.ts");
  token = await vite.ssrLoadModule("/src/utils/token.ts");
  auth = (await vite.ssrLoadModule("/src/addons/platform-api/session/embeddedAuthorization.ts")).useEmbeddedAuthorization();
});
after(async () => {
  session.handleEmbeddedUnauthorized("rejected");
  await vite.close();
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "localStorage");
});
const grants = ["core:admin:read", "core:admin:write"];
function start(jump = 1) {
  session.applyShellSession("synthetic-old", ++version, grants, { id: "41" });
  const previousVersion = version;
  const generation = session.sessionGenerations();
  const signal = session.sessionRequestSignal();
  version += jump;
  session.applyShellSession(null, version, [], null, { previousVersion });
  assert.equal(auth.revalidating.value, true);
  assert.equal(token.getAccessToken(), "");
  assert.deepEqual(auth.permissions.value, []);
  assert.equal(auth.can("core:admin:write"), false);
  assert.equal(signal.aborted, true);
  assert.equal(session.sessionGenerations().businessBoundaryGeneration, generation.businessBoundaryGeneration);
  assert.equal(events.at(-1).businessBoundaryChanged, false);
  return { previousVersion, generation };
}
test("explicit pending retires requests, removes all authority and resumes exact canonical claims", () => {
  const { generation } = start();
  session.applyShellSession("synthetic-new", version, [...grants].reverse().concat(grants), { id: "41" });
  assert.equal(auth.revalidating.value, false);
  assert.equal(token.getAccessToken(), "synthetic-new");
  assert.equal(session.sessionGenerations().businessBoundaryGeneration, generation.businessBoundaryGeneration);
  assert.equal(events.at(-1).businessBoundaryChanged, false);
});
test("version jumps and duplicate pending do not extend the original timeout", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { previousVersion, generation } = start(7);
  t.mock.timers.tick(11_000);
  assert.equal(session.applyShellSession(null, version, [], null, { previousVersion }).changed, false);
  assert.equal(auth.revalidating.value, true);
  t.mock.timers.tick(1_000);
  assert.equal(auth.revalidating.value, false);
  assert.equal(token.getAccessToken(), "");
  assert.equal(session.sessionGenerations().businessBoundaryGeneration, generation.businessBoundaryGeneration + 1);
  assert.equal(session.applyShellSession("synthetic-late", version, grants, { id: "41" }).accepted, false);
  t.mock.timers.reset();
});
for (const [name, principal, permissions, credential] of [
  ["other subject equal claims", { id: "42" }, grants, "synthetic-new"],
  ["removed claim", { id: "41" }, grants.slice(0, 1), "synthetic-new"],
  ["added claim", { id: "41" }, [...grants, "core:tools:read"], "synthetic-new"],
  ["logout", null, [], null],
  ["unverified producer", null, grants, "synthetic-new"],
] as const) test(`${name} destroys retained state`, () => {
  const { generation } = start();
  session.applyShellSession(credential, version, permissions, principal);
  assert.equal(auth.revalidating.value, false);
  assert.equal(session.sessionGenerations().businessBoundaryGeneration, generation.businessBoundaryGeneration + 1);
  assert.equal(events.at(-1).businessBoundaryChanged, true);
});
test("401 while pending destroys retained state and prevents same-version replay", () => {
  const { generation } = start();
  session.handleEmbeddedUnauthorized("rejected");
  assert.equal(auth.revalidating.value, false);
  assert.equal(session.sessionGenerations().businessBoundaryGeneration, generation.businessBoundaryGeneration + 1);
  assert.equal(session.applyShellSession("synthetic-late", version, grants, { id: "41" }).accepted, false);
});
test("unknown pending, concurrent credential or newer final proof cannot reuse old suspension", () => {
  for (const mode of ["bad-previous", "array", "token", "claims", "newer-proof", "unknown-event"]) {
    const { previousVersion, generation } = start();
    if (mode === "newer-proof") session.applyShellSession("synthetic-new", ++version, grants, { id: "41" });
    else if (mode === "unknown-event") session.applyShellSession(null, version);
    else session.applyShellSession(mode === "token" ? "synthetic" : null, version,
      mode === "claims" ? grants : [], null,
      mode === "array" ? Object.assign([], { previousVersion }) : { previousVersion: mode === "bad-previous" ? 0 : previousVersion });
    assert.equal(auth.revalidating.value, false, mode);
    assert.equal(session.sessionGenerations().businessBoundaryGeneration, generation.businessBoundaryGeneration + 1, mode);
  }
});
test("stale auth and stale pending cannot roll the current proof backwards", () => {
  start();
  const stale = version;
  session.applyShellSession("synthetic-b", ++version, grants, { id: "42" });
  const generation = session.sessionGenerations();
  assert.equal(session.applyShellSession("synthetic-a", stale, grants, { id: "41" }).accepted, false);
  assert.equal(session.applyShellSession(null, stale, [], null, { previousVersion: stale - 1 }).accepted, false);
  assert.equal(token.getAccessToken(), "synthetic-b");
  assert.deepEqual(session.sessionGenerations(), generation);
});
