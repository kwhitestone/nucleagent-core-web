import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";

let vite: ViteDevServer;
let api: any;
let unregister: () => void;
let get: (url: string, options: any) => Promise<any>;
let put: (url: string, body: any, options: any) => Promise<any>;
const backend = { backend: "codex", mode: "shared", minProcesses: 3, maxProcesses: 3, sessionsPerProcess: 10, maxActiveSessions: 0,
  readyProcesses: 0, startingProcesses: 3, drainingProcesses: 0, residentProcesses: 3, activeSessions: 0,
  targetCapacity: 30, admissionCapacity: 0, state: "reconciling" };
const runtime = { revision: 1, configurable: true, isolationMode: "isolated", maxConcurrency: 50, backends: [backend] };
const instance = { instanceId: "instance/one", deviceId: "device-one", deviceName: "Worker", os: "linux", appVersion: "",
  connectedAt: "2026-09-08T10:00:00Z", lastSeenAt: "2026-09-08T10:00:01Z", activeExecutions: 0, maxConcurrency: 50, runtime };
const envelope = (data: unknown) => ({ data: { code: 0, message: "ok", data } });

before(async () => {
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime({ http: { get: (url: string, options: any) => get(url, options), put: (url: string, body: any, options: any) => put(url, body, options) } });
  api = await vite.ssrLoadModule("/src/addons/administration/api/executor.ts");
});
after(async () => { unregister(); await vite.close(); });

test("connected executor projection unwraps the real camelCase contract and retains zero readiness", async () => {
  const scope = new AbortController();
  get = async (url, options) => {
    assert.equal(url, "/api/v1/addons/admin/executors"); assert.equal(options.signal, scope.signal);
    return envelope({ instances: [instance, { ...instance, instanceId: "legacy", runtime: null }], updatedAt: instance.lastSeenAt });
  };
  const data = await api.listConnectedExecutors(scope.signal);
  assert.equal(data.instances[0].runtime.backends[0].admissionCapacity, 0);
  assert.equal(data.instances[0].runtime.backends[0].targetCapacity, 30);
  assert.equal(data.instances[0].runtime.backends[0].maxActiveSessions, 0);
  assert.equal(data.instances[1].runtime, null);
  assert.equal(data.updatedAt, instance.lastSeenAt);
});

test("malformed or failed envelopes are errors, never a fake empty connected list", async () => {
  for (const value of [{}, { code: 0 }, { code: 1, message: "denied", data: { instances: [], updatedAt: "now" } },
    { code: 0, data: { instances: [{ ...instance, activeExecutions: "3" }], updatedAt: "now" } },
    { code: 0, data: { instances: [{ ...instance, runtime: { ...runtime, backends: [{ ...backend, admissionCapacity: -1 }] } }], updatedAt: "now" } }]) {
    get = async () => ({ data: value });
    await assert.rejects(api.listConnectedExecutors(new AbortController().signal));
  }
});

test("runtime update encodes instance identity, submits all policies, and preserves actual asynchronous status", async () => {
  const scope = new AbortController();
  const config = { maxConcurrency: 50, backends: [{ backend: "codex", mode: "shared", minProcesses: 3, maxProcesses: 3, sessionsPerProcess: 10, maxActiveSessions: 0 }] };
  put = async (url, body, options) => {
    assert.equal(url, "/api/v1/addons/admin/executors/instance%2Fone/runtime");
    assert.deepEqual(body, { expectedRevision: 1, config }); assert.equal(options.signal, scope.signal);
    return envelope({ accepted: true, status: { ...runtime, revision: 2 } });
  };
  const result = await api.updateExecutorRuntime("instance/one", { expectedRevision: 1, config }, scope.signal);
  assert.equal(result.status.revision, 2);
  assert.equal(result.status.backends[0].admissionCapacity, 0);
  assert.equal(result.status.backends[0].state, "reconciling");
  put = async () => envelope({ accepted: true });
  await assert.rejects(api.updateExecutorRuntime("instance/one", { expectedRevision: 1, config }, scope.signal));
});
