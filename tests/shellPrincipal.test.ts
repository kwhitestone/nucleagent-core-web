import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";

let vite: ViteDevServer;
let session: any;
let token: any;
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
});
after(async () => {
  await vite.close();
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "localStorage");
});

test("trusted principal and canonical grants separate request and business generations", () => {
  const apply = session.applyShellSession;
  apply("synthetic-one", 1, ["core:admin:read", "core:admin:write"], { id: "41" });
  const initial = session.sessionGenerations();
  const signal = session.sessionRequestSignal();
  apply("synthetic-two", 2, [" core:admin:write ", "core:admin:read", "core:admin:read"], { id: "41" });
  assert.equal(token.getAccessToken(), "synthetic-two");
  assert.equal(signal.aborted, true);
  assert.deepEqual(session.sessionGenerations(), {
    requestGeneration: initial.requestGeneration + 1,
    businessBoundaryGeneration: initial.businessBoundaryGeneration,
  });
  assert.equal(events.at(-1).businessBoundaryChanged, false);
  const count = events.length;
  assert.equal(apply("stale", 1, [], { id: "42" }).accepted, false);
  assert.equal(events.length, count);
  apply("synthetic-two", 3, ["core:admin:read"], { id: "41" });
  assert.equal(events.at(-1).businessBoundaryChanged, true);
  apply("synthetic-two", 4, ["core:admin:read"], { id: "42" });
  assert.equal(events.at(-1).businessBoundaryChanged, true);
  apply("synthetic-two", 5, ["core:admin:read"], { id: "42" });
  assert.equal(events.at(-1).businessBoundaryChanged, false);
  session.handleEmbeddedUnauthorized("rejected");
  assert.equal(token.getAccessToken(), "");
  assert.equal(events.at(-1).businessBoundaryChanged, true);
  assert.equal(apply("synthetic-two", 5, [], { id: "42" }).accepted, false);
});

test("missing or malformed principal fails closed, including same-token producers", () => {
  let version = 10;
  for (const principal of [undefined, null, "41", 41, {}, [], { id: 41 }, { id: "" },
    { id: "0" }, { id: "-1" }, { id: "01" }, { id: " 41" }, { id: "4.1" },
    { id: "1e2" }, { id: "9007199254740992" }, { id: "x".repeat(1024) }]) {
    session.applyShellSession("synthetic", version++, ["core:admin:read"], { id: "41" });
    const signal = session.sessionRequestSignal();
    session.applyShellSession("synthetic", version++, ["core:admin:read"], principal);
    assert.equal(token.getAccessToken(), "", JSON.stringify(principal));
    assert.equal(signal.aborted, true);
    assert.equal(events.at(-1).businessBoundaryChanged, true);
  }
});
