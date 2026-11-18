import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";

let vite: ViteDevServer;
let unregister: () => void;
let dom: JSDOM;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let hooks: typeof import("../src/chat-react/useModelPreference.ts");
let current: ReturnType<typeof hooks.useModelPreference>;
let version = 1;
let reads = 0;
let writes = 0;
let failWrite = false;
let readFailure: number | undefined;
let mismatch = false;
let readGate: Promise<void> | undefined;
let writeGate: Promise<void> | undefined;
let writeSignal: AbortSignal | undefined;
let loseAcknowledgement = false;
let commitAfterAbort = false;
const saved = new Map<string, { profileId: string; effort: string }>();

before(async () => {
  dom = new JSDOM("<div id='root'></div>");
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  const runtime = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = runtime.registerPlatformRuntime({ getSessionVersion: () => version, http: {
    get: async (url: string, config: { params: unknown }) => {
      reads++;
      const result = { data: { data: url.endsWith("model-profiles")
        ? [{ id: "quick", enabled: true, efforts: ["low", "medium", "high"] }]
        : saved.get(`${version}:${JSON.stringify(config.params)}`) ?? { profileId: "", effort: "" } } };
      await readGate;
      if (readFailure) throw Object.assign(new Error("read refused"), { status: readFailure });
      if (mismatch && url.endsWith("model-preferences")) return { data: { data: { profileId: "", effort: "" } } };
      return result;
    },
    put: async (_url: string, body: { profileId: string; effort: string }, config: { params: unknown; signal?: AbortSignal }) => {
      writes++;
      const owner = version;
      writeSignal = config.signal;
      await writeGate;
      if (config.signal?.aborted && !commitAfterAbort) throw new Error("aborted transport");
      if (failWrite) throw new Error("unconfirmed write");
      saved.set(`${owner}:${JSON.stringify(config.params)}`, body);
      if (loseAcknowledgement) throw new Error("acknowledgement lost after commit");
      return { data: { data: body } };
    },
  } });
  hooks = await vite.ssrLoadModule("/src/chat-react/useModelPreference.ts") as typeof hooks;
  React = await import("react");
  ({ createRoot } = await import("react-dom/client"));
});
after(async () => { unregister?.(); await vite?.close(); dom?.window.close(); });

test("server-backed choices survive remount, isolate accounts and reconcile saves without retrying unknown writes", async () => {
  function Harness({ scope = "9:codex:7:gpt-6-astra" }: { scope?: string }) {
    current = hooks.useModelPreference(scope, "codex", 7, "gpt-6-astra");
    return null;
  }
  const container = document.getElementById("root")!;
  let root = createRoot(container);
  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    assert.equal(current.ready, true);
    await React.act(async () => current.save("quick", "medium"));
    assert.equal(current.profile?.profileId, "quick");
    assert.equal(current.choice, "medium");
    assert.equal(writes, 1);
    assert.ok(reads >= 3, "save is verified by a fresh server read");
    await React.act(async () => root.unmount());
    root = createRoot(container);
    await React.act(async () => root.render(React.createElement(Harness, { scope: "10:codex:7:gpt-6-astra" })));
    assert.equal(current.profile?.profileId, "quick");
    assert.equal(current.choice, "medium");
    const retiredSave = current.save;
    version++;
    assert.equal(current.ready, false, "session changes synchronously fence submission before rerender");
    await React.act(async () => retiredSave("quick", "high"));
    assert.equal(writes, 1, "retired account callback cannot save into the new account");
    await React.act(async () => window.dispatchEvent(new dom.window.Event("nucleagent:session-change")));
    assert.equal(current.profile?.profileId ?? "", "");
    assert.equal(current.choice, "");
    await React.act(async () => current.save("quick", "low"));
    failWrite = true;
    await React.act(async () => current.save("quick", "high"));
    assert.equal(writes, 3, "unknown write is never automatically repeated");
    assert.equal(current.ready, false);
    assert.equal(current.error, true);
    assert.equal(current.choice, "low", "failed save is not presented as persisted");
  } finally { await React.act(async () => root.unmount()); }
});

test("late reads from a retired account cannot restore its preference", async () => {
  failWrite = false;
  version = 1;
  let release!: () => void;
  readGate = new Promise<void>((resolve) => { release = resolve; });
  function Harness() {
    current = hooks.useModelPreference("9:codex:7:gpt-6-astra", "codex", 7, "gpt-6-astra");
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    version = 3;
    readGate = undefined;
    await React.act(async () => window.dispatchEvent(new dom.window.Event("nucleagent:session-change")));
    await React.act(async () => release());
    assert.equal(current.ready, true);
    assert.equal(current.profile, null);
    assert.equal(current.choice, "");
  } finally { readGate = undefined; await React.act(async () => root.unmount()); }
});

test("session changes abort pending save transport without replaying it under another account", async () => {
  failWrite = false;
  version = 4;
  function Harness() {
    current = hooks.useModelPreference("9:codex:7:gpt-6-astra", "codex", 7, "gpt-6-astra");
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  let release!: () => void;
  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    writeGate = new Promise<void>((resolve) => { release = resolve; });
    let pending!: Promise<void>;
    await React.act(async () => { pending = current.save("quick", "medium"); });
    const count = writes;
    const retiredSignal = writeSignal;
    version = 5;
    await React.act(async () => window.dispatchEvent(new dom.window.Event("nucleagent:session-change")));
    assert.equal(retiredSignal?.aborted, true);
    await React.act(async () => { release(); await pending; });
    assert.equal(writes, count);
    assert.equal(current.profile, null);
    assert.equal(current.choice, "");
    assert.equal(current.ready, true);
  } finally { writeGate = undefined; await React.act(async () => root.unmount()); }
});

for (const changed of [
  { label: "model", conversation: "9", provider: 7, model: "deepseek-v4-flash" },
  { label: "provider", conversation: "9", provider: 8, model: "gpt-6-astra" },
  { label: "conversation", conversation: "10", provider: 7, model: "gpt-6-astra" },
]) test(`review: retired scope save must be fenced after a ${changed.label} change`, async () => {
  version = 30;
  failWrite = false;
  function Harness({ conversation, provider, model }: { conversation: string; provider: number; model: string }) {
    current = hooks.useModelPreference(`${conversation}:codex:${provider}:${model}`, "codex", provider, model);
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  try {
    await React.act(async () => root.render(React.createElement(Harness, { conversation: "9", provider: 7, model: "gpt-6-astra" })));
    const retired = current;
    const retiredSave = current.save;
    await React.act(async () => root.render(React.createElement(Harness, changed)));
    assert.equal(current.ready, true);
    const next = { profile: current.profile, choice: current.choice, ready: current.ready, error: current.error };
    const previousWrites = writes;
    await React.act(async () => retiredSave("quick", "medium"));
    console.log("REVIEW stale scope callback", { extraWrites: writes - previousWrites, readyAfter: current.ready });
    assert.equal(writes, previousWrites, "retired model callback must not issue a write");
    assert.equal(current.ready, true, "retired callback must not replace the new scope state");
    assert.deepEqual({ profile: current.profile, choice: current.choice, ready: current.ready, error: current.error }, next);
    assert.equal(retired.ready, false, "retired consumers cannot send");
  } finally { await React.act(async () => root.unmount()); }
});

test("review: ready must close synchronously when a save starts", async () => {
  version = 31;
  failWrite = false;
  function Harness() {
    current = hooks.useModelPreference("9:codex:7:gpt-6-astra", "codex", 7, "gpt-6-astra");
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  let release!: () => void;
  let pending: Promise<void> | undefined;
  let readyDuringSave: boolean | undefined;
  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    writeGate = new Promise<void>((resolve) => { release = resolve; });
    await React.act(async () => {
      pending = current.save("quick", "medium");
      readyDuringSave = current.ready;
    });
    console.log("REVIEW synchronous submission gate", { readyDuringSave });
    assert.equal(readyDuringSave, false, "send gate must close before GET confirms the write");
  } finally {
    await React.act(async () => { release?.(); await pending; });
    writeGate = undefined;
    await React.act(async () => root.unmount());
  }
});

for (const failure of [false, true]) test(`retired pending save ${failure ? "failure" : "success"} cannot mutate or unlock the new lifecycle`, async () => {
  version++;
  failWrite = false;
  commitAfterAbort = true;
  function Harness({ model }: { model: string }) {
    current = hooks.useModelPreference(`9:codex:7:${model}`, "codex", 7, model);
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  let releaseOld!: () => void;
  let releaseNew!: () => void;
  let oldSave: Promise<void> | undefined;
  let newSave: Promise<void> | undefined;
  try {
    await React.act(async () => root.render(React.createElement(Harness, { model: "gpt-6-astra" })));
    writeGate = new Promise<void>((resolve) => { releaseOld = resolve; });
    await React.act(async () => { oldSave = current.save("quick", "high"); });
    await React.act(async () => root.render(React.createElement(Harness, { model: "deepseek-v4-flash" })));
    assert.equal(current.ready, true);
    writeGate = new Promise<void>((resolve) => { releaseNew = resolve; });
    await React.act(async () => { newSave = current.save("quick", "low"); });
    const count = writes;
    failWrite = failure;
    await React.act(async () => { releaseOld(); await oldSave; });
    assert.equal(current.ready, false);
    assert.equal(current.error, false);
    assert.equal(current.choice, "");
    await React.act(async () => current.save("quick", "medium"));
    assert.equal(writes, count, "retired finally must not unlock the pending current save");
    failWrite = false;
    await React.act(async () => { releaseNew(); await newSave; });
    assert.equal(current.ready, true);
    assert.equal(current.choice, "low");
  } finally {
    failWrite = false;
    await React.act(async () => { releaseOld?.(); releaseNew?.(); await oldSave; await newSave; });
    writeGate = undefined;
    commitAfterAbort = false;
    await React.act(async () => root.unmount());
  }
});

for (const status of [404, 403]) test(`preference GET ${status} remains fail closed on load and readback`, async () => {
  version++;
  failWrite = false;
  function Harness() {
    current = hooks.useModelPreference("9:codex:7:gpt-6-astra", "codex", 7, "gpt-6-astra");
    return null;
  }
  let root = createRoot(document.getElementById("root")!);
  try {
    readFailure = status;
    await React.act(async () => root.render(React.createElement(Harness)));
    assert.equal(current.ready, false);
    assert.equal(current.error, true);
    const count = writes;
    await React.act(async () => current.save("quick", "medium"));
    assert.equal(writes, count);
    await React.act(async () => root.unmount());
    readFailure = undefined;
    root = createRoot(document.getElementById("root")!);
    await React.act(async () => root.render(React.createElement(Harness)));
    const beforeSave = current;
    readFailure = status;
    await React.act(async () => {
      await beforeSave.save("quick", "medium");
      assert.equal(beforeSave.ready, false, "failure must close old render objects before React commits");
      await beforeSave.save("quick", "high");
    });
    assert.equal(current.ready, false);
    assert.equal(current.error, true);
    assert.equal(writes, count + 1, "unconfirmed write is not replayed");
  } finally { readFailure = undefined; await React.act(async () => root.unmount()); }
});

test("mismatched GET keeps the synchronous send gate closed without replay", async () => {
  version++;
  function Harness() {
    current = hooks.useModelPreference("9:codex:7:gpt-6-astra", "codex", 7, "gpt-6-astra");
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    const beforeSave = current;
    const count = writes;
    mismatch = true;
    await React.act(async () => {
      await beforeSave.save("quick", "medium");
      assert.equal(beforeSave.ready, false);
      await beforeSave.save("quick", "high");
    });
    assert.equal(current.ready, false);
    assert.equal(current.error, true);
    assert.equal(writes, count + 1);
  } finally { mismatch = false; await React.act(async () => root.unmount()); }
});

test("review: committed UNKNOWN write recovers on GET without replay", async () => {
  version = 40;
  failWrite = false;
  function Harness() {
    current = hooks.useModelPreference("9:codex:7:gpt-6-astra", "codex", 7, "gpt-6-astra");
    return null;
  }
  let root = createRoot(document.getElementById("root")!);
  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    const previousWrites = writes;
    loseAcknowledgement = true;
    await React.act(async () => current.save("quick", "medium"));
    assert.equal(current.ready, false);
    assert.equal(current.error, true);
    assert.equal(writes, previousWrites + 1);
    loseAcknowledgement = false;
    await React.act(async () => root.unmount());
    root = createRoot(document.getElementById("root")!);
    await React.act(async () => root.render(React.createElement(Harness)));
    assert.equal(current.ready, true);
    assert.equal(current.choice, "medium");
    assert.equal(writes, previousWrites + 1);
  } finally { loseAcknowledgement = false; await React.act(async () => root.unmount()); }
});

test("review: abort is not rollback; a late server commit remains owner scoped", async () => {
  version = 50;
  failWrite = false;
  function Harness() {
    current = hooks.useModelPreference("9:codex:7:gpt-6-astra", "codex", 7, "gpt-6-astra");
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  let release!: () => void;
  let pending: Promise<void> | undefined;
  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    const previousWrites = writes;
    commitAfterAbort = true;
    writeGate = new Promise<void>((resolve) => { release = resolve; });
    await React.act(async () => { pending = current.save("quick", "medium"); });
    const previousSignal = writeSignal;
    version = 51;
    await React.act(async () => window.dispatchEvent(new dom.window.Event("nucleagent:session-change")));
    assert.equal(previousSignal?.aborted, true);
    await React.act(async () => { release(); await pending; });
    assert.equal(current.ready, true);
    assert.equal(current.choice, "");
    version = 50;
    await React.act(async () => window.dispatchEvent(new dom.window.Event("nucleagent:session-change")));
    assert.equal(current.choice, "medium");
    assert.equal(writes, previousWrites + 1);
  } finally {
    release?.();
    await pending;
    writeGate = undefined;
    commitAfterAbort = false;
    await React.act(async () => root.unmount());
  }
});
