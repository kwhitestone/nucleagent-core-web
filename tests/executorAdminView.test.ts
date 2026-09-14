import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { createI18n } from "vue-i18n";
import { createServer, type ViteDevServer } from "vite";

let vite: ViteDevServer;
let card: any;
let editor: any;
let messages: any;
let englishMessages: any;
const policy = { backend: "codex", mode: "shared", minProcesses: 3, maxProcesses: 3, sessionsPerProcess: 10, maxActiveSessions: 0 };
const dedicated = { backend: "claude-code", mode: "dedicated", minProcesses: 2, maxProcesses: 3, sessionsPerProcess: 1, maxActiveSessions: 3 };
const backend = { ...policy, readyProcesses: 0, startingProcesses: 3, drainingProcesses: 0, residentProcesses: 3, activeSessions: 2,
  targetCapacity: 30, admissionCapacity: 0, state: "reconciling", processes: [{ slot: "slot-1", generation: 2, state: "starting", activeSessions: 0 }] };
const runtime = { revision: 7, configurable: true, isolationMode: "isolated", maxConcurrency: 50, backends: [backend] };
const instance = { instanceId: "worker-1", deviceId: "device-1", deviceName: "Worker <fixture>", os: "linux", appVersion: "",
  connectedAt: "2026-09-08T10:00:00Z", lastSeenAt: "2026-09-08T10:00:01Z", activeExecutions: 1, maxConcurrency: 50, runtime };

before(async () => {
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  ({ default: card } = await vite.ssrLoadModule("/src/addons/administration/views/admin/ExecutorInstanceCard.vue"));
  ({ default: editor } = await vite.ssrLoadModule("/src/addons/administration/views/admin/ExecutorRuntimeEditor.vue"));
  ({ default: messages } = await vite.ssrLoadModule("/src/i18n/zh.ts"));
  ({ default: englishMessages } = await vite.ssrLoadModule("/src/i18n/en.ts"));
});
after(async () => { await vite.close(); });

async function render(component: any, props: any, locale = "zh-CN") {
  const app = createSSRApp(component, props);
  app.use(createI18n({ legacy: false, locale, messages: { "zh-CN": messages, en: englishMessages } }));
  return renderToString(app);
}

test("instance table presents reported readiness separately from policy, native sessions and Core reservations", async () => {
  const html = await render(card, { instance, canWrite: true, editing: false });
  assert.match(html, /Worker &lt;fixture&gt;/);
  assert.match(html, /isolated/);
  assert.match(html, /data-admission-capacity="0"/);
  assert.match(html, /data-target-capacity="30"/);
  assert.match(html, /data-active-sessions="2"/);
  assert.match(html, /data-active-executions="1"/);
  assert.match(html, /就绪/);
  assert.match(html, /slot-1/);
  assert.match(html, /data-testid="edit-runtime"/);
});

test("read-only users and legacy runtime snapshots never expose writable controls or invented stats", async () => {
  const readOnly = await render(card, { instance, canWrite: false, editing: false });
  assert.doesNotMatch(readOnly, /data-testid="edit-runtime"/);
  const legacy = await render(card, { instance: { ...instance, runtime: null }, canWrite: true, editing: false });
  assert.match(legacy, /未上报/);
  assert.doesNotMatch(legacy, /data-testid="edit-runtime"/);
  assert.doesNotMatch(legacy, /data-admission-capacity/);
});

test("unavailable backends retain editable desired policy while showing no live capacity", async () => {
  const unavailable = { ...backend, state: "unavailable", readyProcesses: 0, startingProcesses: 0, drainingProcesses: 0,
    residentProcesses: 0, activeSessions: 0, admissionCapacity: 0, processes: [] };
  const html = await render(card, { instance: { ...instance, runtime: { ...runtime, backends: [unavailable] } }, canWrite: true, editing: false });
  assert.match(html, /未启用/);
  assert.match(html, /配置将用于该后端启用后/);
  assert.match(html, /data-admission-capacity="0"/);
  assert.match(html, /data-target-capacity="30"/);
  assert.match(html, /data-active-sessions="0"/);
  assert.match(html, /data-testid="edit-runtime"/);
});

test("pending native policy is applying configuration with zero actual capacity in both languages", async () => {
  const status = { ...backend, state: "reconciling", errorCode: "native_policy_pending", admissionCapacity: 0 };
  for (const [locale, label] of [["zh-CN", "应用配置中"], ["en", "Applying configuration"]]) {
    const html = await render(card, { instance: { ...instance, runtime: { ...runtime, backends: [status] } }, canWrite: true, editing: false }, locale);
    assert.match(html, new RegExp(label));
    assert.match(html, /data-admission-capacity="0"/);
    assert.match(html, /data-target-capacity="30"/);
    assert.doesNotMatch(html, /native_policy_pending/);
    assert.doesNotMatch(html, /class="backend-error"/);
  }
});

test("shared process model distinguishes one service from a pool and exposes the configured maximum", async () => {
  for (const [maxProcesses, label] of [[1, "单进程多会话"], [3, "共享进程池"]] as const) {
    const status = { ...backend, minProcesses: 1, maxProcesses };
    const html = await render(card, { instance: { ...instance, runtime: { ...runtime, backends: [status] } }, canWrite: true, editing: false });
    assert.match(html, new RegExp(label));
    assert.match(html, new RegExp(`进程上限 ${maxProcesses}`));
    assert.match(html, /就绪进程 \/ 预热目标/);
  }
});

test("dedicated total readiness and process limit are distinct from recoverable admission capacity", async () => {
  const status = { ...backend, ...dedicated, readyProcesses: 2, startingProcesses: 0, residentProcesses: 3,
    targetCapacity: 3, admissionCapacity: 3, state: "ready" };
  const html = await render(card, { instance: { ...instance, runtime: { ...runtime, backends: [status] } }, canWrite: true, editing: false });
  assert.match(html, /就绪进程 \/ 预热目标/);
  assert.match(html, /进程上限 3/);
  assert.match(html, /活跃任务上限 3/);
  assert.match(html, /可接纳 \/ 目标容量/);
  assert.match(html, /可接纳任务总预算 \/ 配置目标/);
  assert.match(html, /缓存命中/); assert.match(html, /回收空闲进程/); assert.match(html, /Agent 初始化/);
  assert.doesNotMatch(html, /备用|无总上限|已就绪总容量/);
});

test("runtime editor uses bounded policy inputs and keeps dedicated mode fixed", async () => {
  const draft = { instanceId: "worker-1", expectedRevision: 7, config: { maxConcurrency: 50, backends: [policy, dedicated] } };
  const html = await render(editor, { editor: draft, runtime, deviceName: "Worker", saving: false, canWrite: true });
  assert.match(html, /max="65536"/); assert.match(html, /max="64"/); assert.match(html, /max="1024"/);
  assert.match(html, /总预热进程目标/);
  assert.match(html, /aria-label="claude-code 进程上限"[^>]*value="3"/);
  assert.doesNotMatch(html, /备用进程目标|无总进程上限/);
  assert.match(html, /活跃任务上限/);
  assert.doesNotMatch(html, /<select/);
  assert.match(html, /data-testid="save-runtime"/);
  const conflict = await render(editor, { editor: draft, runtime: { ...runtime, revision: 8 }, deviceName: "Worker", saving: false, canWrite: true });
  assert.match(conflict, /配置版本已变化/);
  assert.match(conflict, /data-testid="save-runtime"[^>]*disabled/);
  const lostAccess = await render(editor, { editor: draft, runtime, deviceName: "Worker", saving: false, canWrite: false });
  assert.match(lostAccess, /data-testid="save-runtime"[^>]*disabled/);
});

test("legacy max zero is displayed without conversion and the editor requires an explicit finite limit", async () => {
  const oldPolicy = { ...dedicated, maxProcesses: 0 };
  const oldRuntime = { ...runtime, backends: [{ ...backend, ...oldPolicy }] };
  const html = await render(card, { instance: { ...instance, runtime: oldRuntime }, canWrite: true, editing: false });
  assert.match(html, /旧版：进程无总上限/);
  const draft = { instanceId: "worker-1", expectedRevision: 7, config: { maxConcurrency: 50, backends: [oldPolicy] } };
  const form = await render(editor, { editor: draft, runtime: oldRuntime, deviceName: "Worker", saving: false, canWrite: true });
  assert.match(form, /aria-label="claude-code 进程上限"[^>]*value="0"/);
  assert.match(form, /升级执行器/);
  assert.match(form, /data-testid="save-runtime"[^>]*disabled/);
});

test("native preparation, health probes and unhealthy processes have readable status labels", async () => {
  for (const [state, zh, en] of [["preparing", "准备中", "Preparing"], ["probing", "健康检查中", "Checking health"], ["unhealthy", "不健康", "Unhealthy"]]) {
    const status = { ...backend, state, processes: [{ slot: "fixture", generation: 1, state, activeSessions: 0 }] };
    for (const [locale, label] of [["zh-CN", zh], ["en", en]]) {
      const html = await render(card, { instance: { ...instance, runtime: { ...runtime, backends: [status] } }, canWrite: true, editing: false }, locale);
      assert.match(html, new RegExp(label));
    }
  }
});

test("executor administration belongs to the existing admin route scope", async () => {
  const { default: addon } = await vite.ssrLoadModule("/src/addons/administration/index.ts");
  const route = addon.routes.find((row: any) => row.path === "/admin").children.find((row: any) => row.path === "executors");
  assert.equal(route?.name, "admin-executors");
  assert.equal(typeof route?.component, "function");
});
