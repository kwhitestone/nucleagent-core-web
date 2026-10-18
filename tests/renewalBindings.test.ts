import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { resolve } from "node:path";
import { AxiosError, isCancel } from "axios";
import { createServer } from "vite";
import { createRenderer, defineComponent, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";

let vite: any, runtime: any, session: any, useSessionBindings: any, unregister: () => void;
let version = 0, sequence = 0;
const settle = async () => {
  for (let n = 0; n < 8; n++) { await new Promise(resolve => setImmediate(resolve)); await nextTick(); }
};
before(async () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(new EventTarget(), { parent: {} }) });
  Object.defineProperty(globalThis, "localStorage", { configurable: true,
    value: { getItem: () => null, setItem() {}, removeItem() {} } });
  vite = await createServer({ configFile: false, appType: "custom",
    resolve: { alias: { "@": resolve("src") } }, optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  ({ platformRuntime: runtime } = await vite.ssrLoadModule("/src/addons/platform-api/runtime.ts"));
  const contract = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = contract.registerPlatformRuntime(runtime);
  session = await vite.ssrLoadModule("/src/addons/platform-api/session/embeddedSession.ts");
  ({ useSessionBindings } = await vite.ssrLoadModule("/src/addons/conversation/composables/useSessionBindings.ts"));
});
after(async () => {
  unregister?.();
  await vite?.close();
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "localStorage");
});

type Held = { config: any; finish: (data?: any) => void; fail: (status: number) => void };
async function mountCase(holdSync = false) {
  const id = ref(String(++sequence)), busy = ref(false);
  let state: any, mounts = 0, revision = "1", principal = "41", delaySync = holdSync;
  const puts: Held[] = [], syncs: Held[] = [], reads: Held[] = [];
  const snapshot = (skills: number[] = []) => ({ principal, revision, skillIds: skills, toolIds: [], editable: true });
  const apply = (who: string | null = "41", grants = ["core:admin:write", "core:admin:read"], identity: unknown = { id: who }) =>
    runtime.applyShellSession(who ? `synthetic-${++version}` : null, ++version, grants, identity);
  apply(null);
  apply();
  runtime.http.defaults.adapter = (config: any) => {
    const response = (data: any) => ({ config, data: { data }, headers: {}, status: 200, statusText: "Synthetic" });
    const queue = config.method === "put" ? puts :
      config.url.endsWith("/bindings/sync") ? syncs : config.url === "/ordinary" ? reads : null;
    if (!queue) return Promise.resolve(response([]));
    let finish!: Held["finish"], fail!: Held["fail"];
    const initial = snapshot();
    const promise = new Promise((resolve, reject) => {
      finish = (data = initial) => resolve(response(data));
      fail = status => reject(new AxiosError("Synthetic failure", undefined, config, undefined, {
        config, status, statusText: "Synthetic", headers: {}, data: { code: status === 409 ? "busy" : "failed" },
      }));
    });
    queue.push({ config, finish, fail });
    if (queue === syncs && !delaySync) finish();
    return promise;
  };
  const renderer = createRenderer<any, any>({
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
    parentNode: () => null, nextSibling: () => null,
  });
  const owner = defineComponent({ setup() {
    mounts++;
    state = useSessionBindings(() => id.value, () => busy.value);
    return () => h("span", String(state.pending.value));
  } });
  const app = renderer.createApp(owner);
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: {} }, missingWarn: false, fallbackWarn: false }));
  app.mount({});
  await settle();
  return { state, app, puts, syncs, reads, busy, id, apply, snapshot, mounts: () => mounts,
    setRevision(value: string) { revision = value; },
    setPrincipal(value: string) { principal = value; },
    holdSync(value: boolean) { delaySync = value; } };
}

test("renewal preserves mounted draft, busy controls and a successful PUT without issuing a competing fence", async () => {
  const f = await mountCase();
  try {
    f.state.skillIds.value = [7];
    f.busy.value = true;
    await f.state.save();
    assert.equal(f.puts.length, 0, "an active turn blocks saving");
    f.busy.value = false;
    const saving = f.state.save();
    await settle();
    const oldRequest = session.sessionRequestSignal();
    const business = session.sessionRequestSignal("business");
    f.apply("41", [" core:admin:read ", "core:admin:write", "core:admin:read"]);
    f.apply();
    await settle();
    assert.equal(oldRequest.aborted, true, "ordinary reads retire on renewal");
    assert.equal(business.aborted, false, "same verified grants retain pending writes");
    assert.equal(f.puts[0].config.signal.aborted, false, "the real HTTP interceptor uses business scope");
    assert.equal(f.state.saving.value, true);
    assert.equal(f.state.saved.value.editable, true);
    assert.deepEqual(f.state.skillIds.value, [7]);
    assert.equal(f.state.pending.value, true);
    assert.equal(f.state.uncertain.value, true, "pending PUT has not confirmed its write barrier");
    assert.equal(f.mounts(), 1);
    assert.equal(f.syncs.length, 1, "renewal must not fence its own in-flight PUT");
    await f.state.save();
    f.state.discard();
    assert.equal(f.puts.length, 1);
    assert.deepEqual(f.state.skillIds.value, [7]);
    f.setRevision("2");
    f.puts[0].finish(f.snapshot([7]));
    await saving;
    assert.deepEqual(f.state.saved.value.skillIds, [7]);
    assert.equal(f.state.saving.value, false);
    assert.equal(f.state.pending.value, false);
  } finally { f.app.unmount(); }
});

for (const status of [409, 500, 401]) {
  test(`renewed PUT failure ${status} retains the draft and unknown-write barrier until a newer fence`, async () => {
    const f = await mountCase();
    try {
      f.state.skillIds.value = [7];
      const saving = f.state.save();
      await settle();
      f.apply();
      f.puts[0].fail(status);
      await saving;
      assert.equal(runtime.getAccessToken() !== "", true, "a stale credential 401 cannot log out the renewed session");
      assert.equal(f.state.saving.value, false);
      assert.equal(f.state.uncertain.value, true);
      assert.equal(f.state.pending.value, true);
      assert.deepEqual(f.state.skillIds.value, [7]);
      assert.ok(f.state.error.value);
      f.apply();
      f.state.discard();
      await f.state.save();
      assert.equal(f.puts.length, 1);
      assert.deepEqual(f.state.skillIds.value, [7]);
      await f.state.load();
      assert.equal(f.state.saved.value, null, "same-revision sync cannot erase an unknown write");
      assert.equal(f.state.pending.value, true);
      f.setRevision("3");
      await f.state.load();
      assert.equal(f.state.pending.value, false);
    } finally { f.app.unmount(); }
  });
}

test("pending sync survives delayed renewal while an ordinary GET is canceled", async () => {
  const f = await mountCase(true);
  try {
    const read = runtime.http.get("/ordinary").catch((error: unknown) => error);
    f.apply();
    await settle();
    assert.equal(f.syncs.length, 1);
    assert.equal(f.syncs[0].config.signal.aborted, false);
    assert.equal(f.reads[0].config.signal.aborted, true);
    assert.equal(f.state.loading.value, true);
    f.reads[0].finish([]);
    assert.ok(isCancel(await read));
    f.syncs[0].finish();
    await settle();
    assert.equal(f.state.saved.value.revision, "1");
    assert.equal(f.state.pending.value, false);
  } finally { f.app.unmount(); }
});

test("renewal does not extend the write deadline; late success cannot clear the unknown barrier", async t => {
  const f = await mountCase();
  try {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    f.state.skillIds.value = [7];
    const saving = f.state.save();
    await settle();
    t.mock.timers.tick(14000);
    f.apply();
    await settle();
    assert.equal(f.state.saving.value, true);
    t.mock.timers.tick(1001);
    t.mock.timers.reset();
    await saving;
    assert.equal(f.state.saving.value, false);
    assert.equal(f.state.uncertain.value, true);
    assert.equal(f.state.pending.value, true);
    assert.equal(f.puts[0].config.signal.aborted, true);
    f.setRevision("2");
    f.puts[0].finish(f.snapshot([7]));
    await settle();
    assert.equal(f.state.saved.value.revision, "1");
    assert.deepEqual(f.state.skillIds.value, [7]);
    await f.state.save();
    assert.equal(f.puts.length, 1);
    f.setRevision("3");
    await f.state.load();
    assert.equal(f.state.pending.value, false);
  } finally { t.mock.timers.reset(); f.app.unmount(); }
});

for (const boundary of ["logout", "account", "revocation", "unknown", "401", "legacy", "route"]) {
  test(`${boundary} clears protected selections and rejects late writes; relogin requires an authoritative fence`, async () => {
    const f = await mountCase();
    try {
      f.state.skillIds.value = [7];
      const saving = f.state.save();
      await settle();
      const business = session.sessionRequestSignal("business");
      f.holdSync(true);
      if (boundary === "logout") f.apply(null);
      if (boundary === "account") { f.setPrincipal("42"); f.apply("42"); }
      if (boundary === "revocation") f.apply("41", ["core:admin:read"]);
      if (boundary === "unknown") f.apply("41", ["core:admin:write", "core:admin:read"], {});
      if (boundary === "401") f.puts[0].fail(401);
      if (boundary === "legacy") window.dispatchEvent(new CustomEvent("nucleagent:session-change", { detail: { authenticated: true } }));
      if (boundary === "route") f.id.value = `${f.id.value}-other`;
      await settle();
      if (boundary !== "legacy" && boundary !== "route") {
        assert.equal(business.aborted, true, "identity/grants/current401 must retire business HTTP");
      }
      assert.equal(f.puts[0].config.signal.aborted, true);
      assert.equal(f.state.saved.value, null);
      assert.deepEqual(f.state.skillIds.value, []);
      assert.equal(f.state.pending.value, true);
      f.puts[0].finish({ ...f.snapshot([7]), principal: "41", revision: "2" });
      await saving;
      assert.equal(f.state.saved.value, null, "retired PUT cannot restore state");
      f.setPrincipal("41");
      f.holdSync(false);
      if (boundary === "route") f.id.value = f.id.value.replace("-other", "");
      else { f.apply(null); f.apply(); }
      await settle();
      assert.equal(f.state.saved.value, null, "returning to A must not accept its unresolved revision");
      assert.equal(f.state.pending.value, true);
      f.setRevision("3");
      await f.state.load();
      assert.equal(f.state.pending.value, false);
      for (const old of f.syncs.slice(1, -2)) old.finish();
      await settle();
      assert.equal(f.state.saved.value.revision, "3", "late cross-scope sync must not roll back current state");
    } finally { f.app.unmount(); }
  });
}
