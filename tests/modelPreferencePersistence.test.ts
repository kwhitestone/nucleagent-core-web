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
let readGate: Promise<void> | undefined;
let writeGate: Promise<void> | undefined;
let writeSignal: AbortSignal | undefined;
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
      return result;
    },
    put: async (_url: string, body: { profileId: string; effort: string }, config: { params: unknown; signal?: AbortSignal }) => {
      writes++;
      const owner = version;
      writeSignal = config.signal;
      await writeGate;
      if (config.signal?.aborted) throw new Error("aborted transport");
      if (failWrite) throw new Error("unconfirmed write");
      saved.set(`${owner}:${JSON.stringify(config.params)}`, body);
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
