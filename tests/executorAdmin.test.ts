import assert from "node:assert/strict";
import test from "node:test";
import { createExecutorManagement, runtimeConfigFromStatus, validateRuntimeConfig } from "../src/addons/administration/executors/executorManagement.ts";

const runtime = (revision = 7) => ({
  revision, configurable: true, isolationMode: "isolated", maxConcurrency: 12,
  backends: [
    { backend: "codex", mode: "shared", minProcesses: 2, maxProcesses: 2, sessionsPerProcess: 3, maxActiveSessions: 0,
      readyProcesses: 1, startingProcesses: 1, drainingProcesses: 0, residentProcesses: 2,
      activeSessions: 2, targetCapacity: 6, admissionCapacity: 3, state: "reconciling", processes: [] },
    { backend: "claude-code", mode: "dedicated", minProcesses: 2, maxProcesses: 3, sessionsPerProcess: 1, maxActiveSessions: 3,
      readyProcesses: 2, startingProcesses: 0, drainingProcesses: 0, residentProcesses: 3,
      activeSessions: 0, targetCapacity: 3, admissionCapacity: 3, state: "ready", processes: [] },
  ],
});
const snapshot = (revision = 7) => ({ updatedAt: "2026-09-08T10:00:00Z", instances: [
  { instanceId: "instance/one", deviceId: "device-1", deviceName: "Worker", os: "linux", appVersion: "1.0",
    connectedAt: "2026-09-08T09:00:00Z", lastSeenAt: "2026-09-08T10:00:00Z", activeExecutions: 2, maxConcurrency: 12, runtime: runtime(revision) },
] });
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test("runtime draft copies every backend without converting desired settings into actual capacity", () => {
  const source = runtime();
  const config = runtimeConfigFromStatus(source);
  assert.deepEqual(config.backends.map(row => row.backend), ["codex", "claude-code"]);
  assert.equal(config.backends[1].maxProcesses, 3);
  assert.equal(config.backends[1].sessionsPerProcess, 1);
  assert.equal(config.backends[0].maxActiveSessions, 0);
  assert.equal(config.backends[1].maxActiveSessions, 3);
  config.backends[0].minProcesses = 1;
  assert.equal(source.backends[0].minProcesses, 2);
  assert.equal(source.backends[0].admissionCapacity, 3);
  assert.equal("admissionCapacity" in config.backends[0], false);
  assert.equal("isolationMode" in config, false);
});

test("configuration validates integers, shared pool bounds and dedicated fixed fields", () => {
  const valid = runtimeConfigFromStatus(runtime());
  assert.equal(validateRuntimeConfig(valid), null);
  for (const number of [0, -1, 65_537, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.ok(validateRuntimeConfig({ ...valid, maxConcurrency: number }));
  }
  for (const patch of [{ minProcesses: 0 }, { minProcesses: -1 }, { minProcesses: 3 }, { maxProcesses: 0 }, { maxProcesses: 65 }, { sessionsPerProcess: 0 }, { sessionsPerProcess: 1025 }, { sessionsPerProcess: 1.2 }]) {
    assert.ok(validateRuntimeConfig({ ...valid, backends: [{ ...valid.backends[0], ...patch }, valid.backends[1]] }));
  }
  for (const patch of [{ maxProcesses: 0 }, { maxProcesses: 1 }, { maxProcesses: 65 }, { minProcesses: 4 }, { sessionsPerProcess: 2 }, { maxActiveSessions: 0 }, { maxActiveSessions: 65_537 }, { mode: "unknown" }]) {
    assert.ok(validateRuntimeConfig({ ...valid, backends: [valid.backends[0], { ...valid.backends[1], ...patch }] }));
  }
  assert.equal(validateRuntimeConfig({ ...valid, maxConcurrency: 65_536, backends: [{ ...valid.backends[0], minProcesses: 64, maxProcesses: 64, sessionsPerProcess: 1024 }] }), null);
});

test("refresh preserves editing drafts, uses reported zero capacity, and latest response wins", async () => {
  let next = snapshot();
  const pending = deferred<ReturnType<typeof snapshot>>();
  let reads = 0;
  const controller = createExecutorManagement({
    list: async () => ++reads === 2 ? pending.promise : next,
    update: async () => ({ accepted: true, status: runtime(8) }),
  });
  await controller.refresh();
  assert.equal(controller.edit("instance/one"), true);
  controller.setConcurrency(30);
  const stale = controller.refresh();
  next = snapshot(8);
  next.instances[0].runtime.backends[0].admissionCapacity = 0;
  await controller.refresh();
  pending.resolve(snapshot(6));
  await stale;
  assert.equal(controller.state.instances?.[0].runtime?.revision, 8);
  assert.equal(controller.state.instances?.[0].runtime?.backends[0].admissionCapacity, 0);
  assert.equal(controller.state.editor?.config.maxConcurrency, 30);
  assert.equal(controller.state.editor?.expectedRevision, 7);
  controller.dispose();
});

test("save submits an immutable complete configuration with revision and then shows actual accepted state", async () => {
  let saved: unknown;
  const controller = createExecutorManagement({ list: async () => snapshot(), update: async (id, body) => {
    assert.equal(id, "instance/one"); saved = body;
    const status = runtime(8); status.maxConcurrency = 30;
    status.backends[0].minProcesses = 1;
    return { accepted: true, status };
  } });
  await controller.refresh(); controller.edit("instance/one");
  controller.setConcurrency(30); controller.setBackend(0, "minProcesses", 1);
  assert.equal(await controller.save(), true);
  assert.deepEqual(saved, { expectedRevision: 7, config: { maxConcurrency: 30, backends: [
    { backend: "codex", mode: "shared", minProcesses: 1, maxProcesses: 2, sessionsPerProcess: 3, maxActiveSessions: 0 },
    { backend: "claude-code", mode: "dedicated", minProcesses: 2, maxProcesses: 3, sessionsPerProcess: 1, maxActiveSessions: 3 },
  ] } });
  assert.equal(controller.state.editor, null);
  assert.equal(controller.state.instances?.[0].runtime?.revision, 8);
  assert.equal(controller.state.instances?.[0].runtime?.backends[0].admissionCapacity, 3);
  assert.equal(controller.state.instances?.[0].runtime?.backends[0].state, "reconciling");
  assert.equal(controller.state.notice, "saved");
  controller.dispose();
});

test("revision conflict and uncertain save refresh reality without overwriting or resubmitting the draft", async () => {
  for (const status of [409, 502, 503, 504]) {
    let reads = 0; let writes = 0;
    const controller = createExecutorManagement({ list: async () => snapshot(++reads === 1 ? 7 : 8), update: async () => {
      writes += 1; throw Object.assign(new Error("Fixture save failure"), { status });
    } });
    await controller.refresh(); controller.edit("instance/one"); controller.setConcurrency(30);
    assert.equal(await controller.save(), false);
    assert.equal(controller.state.instances?.[0].runtime?.revision, 8);
    assert.equal(controller.state.editor?.config.maxConcurrency, 30);
    assert.equal(controller.state.editor?.expectedRevision, 7);
    assert.equal(await controller.save(), false);
    assert.equal(writes, 1, "requires explicit reload after a configuration conflict");
    assert.equal(controller.edit("instance/one"), true);
    assert.equal(controller.state.editor?.expectedRevision, 8);
    controller.dispose();
  }
});

test("invalid drafts, unreported legacy runtimes and disconnected instances cannot be configured", async () => {
  let next: any = snapshot(); let writes = 0;
  const controller = createExecutorManagement({ list: async () => next, update: async () => {
    writes += 1; return { accepted: true, status: runtime(8) };
  } });
  await controller.refresh(); controller.edit("instance/one"); controller.setConcurrency(0);
  assert.equal(await controller.save(), false); assert.equal(writes, 0);
  next = { ...snapshot(), instances: [] }; await controller.refresh();
  assert.equal(await controller.save(), false); assert.equal(writes, 0);
  next = snapshot(); next.instances[0].runtime = null; await controller.refresh();
  assert.equal(controller.edit("instance/one"), false);
  controller.cancelEdit(); assert.equal(controller.state.editor, null);
  controller.dispose();
});

test("dispose aborts pending reads and writes and prevents stale updates reaching another page", async () => {
  const pending = deferred<ReturnType<typeof snapshot>>(); let signal: AbortSignal | undefined;
  const changes: unknown[] = [];
  const controller = createExecutorManagement({ list: async (scope) => { signal = scope; return pending.promise; }, update: async () => ({ accepted: false }) }, next => changes.push(next));
  const loading = controller.refresh(); controller.dispose(); const count = changes.length;
  pending.resolve(snapshot()); await loading;
  assert.equal(signal?.aborted, true); assert.equal(changes.length, count);
  assert.equal(controller.state.instances, null);
  assert.equal(await controller.save(), false);
});

test("dedicated total process and active limits are independently editable and shared caps survive editing", async () => {
  const source = snapshot(); source.instances[0].runtime.backends[0].maxActiveSessions = 5;
  const controller = createExecutorManagement({ list: async () => source, update: async () => ({ accepted: false }) });
  await controller.refresh(); controller.edit("instance/one");
  controller.setBackend(1, "maxActiveSessions", 6);
  controller.setBackend(1, "sessionsPerProcess", 9);
  controller.setBackend(1, "maxProcesses", 9);
  assert.equal(controller.state.editor?.config.backends[1].maxActiveSessions, 6);
  assert.equal(controller.state.editor?.config.backends[1].minProcesses, 2);
  assert.equal(controller.state.editor?.config.backends[1].sessionsPerProcess, 1);
  assert.equal(controller.state.editor?.config.backends[1].maxProcesses, 9);
  assert.equal(controller.state.editor?.config.backends[0].maxActiveSessions, 5);
  assert.equal(source.instances[0].runtime.backends[1].maxActiveSessions, 3);
  controller.dispose();
});

test("legacy unlimited dedicated policies stay unchanged until a finite process limit is explicitly entered", async () => {
  const source = snapshot(); source.instances[0].runtime.backends[1].maxProcesses = 0;
  let writes = 0;
  const controller = createExecutorManagement({ list: async () => source, update: async (_id, body) => {
    writes += 1;
    assert.equal(body.config.backends[1].maxProcesses, 3);
    return { accepted: true, status: runtime(8) };
  } });
  await controller.refresh(); controller.edit("instance/one"); controller.setConcurrency(30);
  assert.equal(controller.state.editor?.config.backends[1].maxProcesses, 0);
  assert.equal(await controller.save(), false); assert.equal(writes, 0);
  assert.equal(controller.state.error?.kind, "legacyProcessLimit");
  controller.setBackend(1, "maxProcesses", 3);
  assert.equal(await controller.save(), true); assert.equal(writes, 1);
  assert.equal(source.instances[0].runtime.backends[1].maxProcesses, 0);
  controller.dispose();
});

test("read failures keep the last measured snapshot and failed writes never fabricate acceptance", async () => {
  let reads = 0;
  const controller = createExecutorManagement({ list: async () => {
    if (++reads > 1) throw new Error("Fixture is offline"); return snapshot();
  }, update: async () => ({ accepted: false, errorCode: "fixture_rejected" }) });
  await controller.refresh(); await controller.refresh();
  assert.equal(controller.state.error?.kind, "loadFailed");
  assert.equal(controller.state.updatedAt, snapshot().updatedAt);
  assert.equal(controller.state.instances?.[0].runtime?.revision, 7);
  controller.edit("instance/one");
  assert.equal(await controller.save(), false);
  assert.equal(controller.state.error?.kind, "saveFailed");
  assert.equal(controller.state.editor?.expectedRevision, 7);
  assert.equal(controller.state.notice, null);
  controller.dispose();
});

test("saving fences stale polls, duplicate writes, draft changes and unmounted completions", async () => {
  const pending = deferred<any>(); let writes = 0; let reads = 0; let signal: AbortSignal | undefined;
  const controller = createExecutorManagement({ list: async () => { reads += 1; return snapshot(); }, update: async (_id, _body, scope) => {
    writes += 1; signal = scope; return pending.promise;
  } });
  await controller.refresh(); controller.edit("instance/one");
  const saving = controller.save();
  assert.equal(await controller.save(), false); await controller.refresh();
  controller.setConcurrency(500); controller.setBackend(0, "minProcesses", 1); controller.cancelEdit();
  assert.equal(controller.state.editor?.config.maxConcurrency, 12);
  assert.equal(controller.state.editor?.config.backends[0].minProcesses, 2);
  assert.equal(reads, 1); assert.equal(writes, 1);
  controller.dispose(); pending.resolve({ accepted: true, status: runtime(8) });
  assert.equal(await saving, false); assert.equal(signal?.aborted, true);
  assert.equal(controller.state.instances, null); assert.equal(controller.state.editor, null);
});
