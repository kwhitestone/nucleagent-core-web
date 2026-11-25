// MUYU-365 remaining/GAP G-1/G-2/G-3/G-6: say *why* something is unavailable, using only fields Core already sends
// (prod-cn 2026-11-25, remaining/evidence/prod-cn-gap-get.json). Warnings stay, disabled stays disabled, nothing is removed.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";
import { ZH_STRINGS } from "../src/chat-react/islandStringsZh.ts";
import { EN_STRINGS } from "../src/chat-react/islandStringsEn.ts";

let vite: ViteDevServer;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let app: typeof import("../src/chat-react/ChatApp.tsx");
let sel: typeof import("../src/chat-react/modelSelection.ts");
let Profile: typeof import("../src/chat-react/ProfileControls.tsx").default;
let grants: typeof import("../src/chat-react/ToolGrants.tsx");
const zh = (key: string) => key.startsWith("chatReact.") ? (ZH_STRINGS as Record<string, string>)[key.slice(10)] ?? key : key;

before(async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://test.example/" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: dom.window.localStorage });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, MutationObserver: dom.window.MutationObserver });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  React = await import("react");
  ({ createRoot } = await import("react-dom/client"));
  app = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx") as typeof app;
  sel = await vite.ssrLoadModule("/src/chat-react/modelSelection.ts") as typeof sel;
  Profile = (await vite.ssrLoadModule("/src/chat-react/ProfileControls.tsx")).default;
  grants = await vite.ssrLoadModule("/src/chat-react/ToolGrants.tsx") as typeof grants;
});
after(async () => { await vite?.close(); });

// ---- G-1: a current model that is upstream-unavailable says which reason (Core enum, llmproxy/catalog_sync.go:317) ----
const chat = (model: string, over: Record<string, unknown> = {}) => ({ value: `chat:1:${model}`, label: model, hint: "P", choice: { kind: "chat" as const, model: { providerId: 1, model } }, ...over });
const executor = { kind: "executor" as const, options: [{ value: "executor:codex", label: "Codex", choice: { kind: "executor" as const, backend: "codex" } }] };
async function menu(reason: string) {
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  const groups = [{ kind: "chat" as const, options: [chat("ok-model"), chat("down", { unavailable: reason })] }, executor];
  await React.act(async () => root.render(React.createElement(app.ModelMenu as never, { t: zh, groups, value: "chat:1:down", backend: "codex", disabled: false, onPick: () => {} })));
  const trigger = container.querySelector<HTMLButtonElement>("[data-testid=mc-model]")!;
  await React.act(async () => trigger.click());
  return { container, trigger, close: () => React.act(async () => root.unmount()) };
}

test("G-1: every Core unavailableReason has its own zh and en notice; upstream_offline reads 上游离线", () => {
  for (const reason of ["auth_401", "capacity", "route_disabled", "upstream_offline", "unknown"]) {
    for (const strings of [ZH_STRINGS, EN_STRINGS] as Record<string, string>[]) assert.ok(strings[`modelStale_${reason}`], `${reason} has a string`);
  }
  assert.match(ZH_STRINGS.modelStale_upstream_offline, /上游离线/);
  const all = ["auth_401", "capacity", "route_disabled", "upstream_offline"].map((r) => (ZH_STRINGS as Record<string, string>)[`modelStale_${r}`]);
  assert.equal(new Set(all).size, all.length, "the cases read differently");
  for (const text of all) assert.match(text, /本会话仍保持原选择/, "still says nothing was swapped");
});

test("G-1: the stale notice and pill label name the real reason; the model stays on the pill with ⚠ and is not pickable", async () => {
  for (const [reason, expect] of [["upstream_offline", ZH_STRINGS.modelStale_upstream_offline], ["capacity", ZH_STRINGS.modelStale_capacity], ["unknown", ZH_STRINGS.modelStale_unknown]]) {
    const v = await menu(reason);
    try {
      assert.equal(v.container.querySelector("[data-testid=mc-model-stale]")!.textContent, expect);
      assert.ok(v.trigger.getAttribute("aria-label")!.includes(expect), "label says the same reason");
      assert.ok(v.trigger.hasAttribute("data-stale"));
      assert.match(v.trigger.textContent!, /⚠/);
      const names = [...v.container.querySelectorAll("[role=option] .mc-menu-name")].map((o) => o.textContent);
      assert.ok(names.includes("down"), "kept in the list");
    } finally { await v.close(); }
  }
});

// ---- G-2: a stale preset says why, from Core's per-code reason on the protocol/level (llmproxy/model_capability.go:131,135,164,167) ----
const capability = { model: "m", capability_revision: 3, protocols: {
  responses: { selectable: true, reason_code: "", reason: "", thinking_levels: {
    off: { status: "policy_forbidden", reason_code: "policy_forbidden", reason: "此版本按产品策略不可关闭思考" },
    low: { status: "supported" },
    medium: { status: "unverified", reason_code: "unsupported_thinking_level", reason: "该协议不支持所选思考档位" },
    high: { status: "unverified", reason_code: "native_parameter_unverified", reason: "原生参数映射尚未验证，不能静默降档" } } },
  messages: { selectable: false, reason_code: "native_protocol_unsupported", reason: "本原生后端尚未验证此调用协议，不能转换或直连", thinking_levels: {} },
} };

test("G-2: staleReason gives Core's reason for the failing level or protocol; none for a usable or protocol-less preset", () => {
  const view = sel.capabilityView(capability, "codex", { model: "m" });
  assert.equal(sel.staleReason(view, { callProtocol: "responses", thinkingLevel: "off" }), "此版本按产品策略不可关闭思考");
  assert.equal(sel.staleReason(view, { callProtocol: "responses", thinkingLevel: "medium" }), "该协议不支持所选思考档位");
  assert.equal(sel.staleReason(view, { callProtocol: "responses", thinkingLevel: "high" }), "原生参数映射尚未验证，不能静默降档");
  assert.equal(sel.staleReason(view, { callProtocol: "messages", thinkingLevel: "low" }), "本原生后端尚未验证此调用协议，不能转换或直连", "protocol reason wins");
  assert.equal(sel.staleReason(view, { callProtocol: "responses", thinkingLevel: "low" }), undefined, "usable: no reason");
  assert.equal(sel.staleReason(view, { reasoningEffort: "low" }), undefined);
  assert.equal(sel.staleReason(sel.capabilityView(undefined, "codex"), { callProtocol: "responses" }), undefined, "no declaration: nothing invented");
  // The machine code still never reaches the view (stage2Selection keeps asserting that).
  assert.ok(!JSON.stringify(view).includes("reason_code"));
});

const ROWS = [
  { id: "deep", displayName: "深度思考", enabled: true, params: { callProtocol: "responses", thinkingLevel: "high" } },
  { id: "long-context", displayName: "长上下文", enabled: false, reason: "暂未开放" },
  { id: "img", displayName: "默认生成", enabled: false, reason: "上游当前不可用（网关模型状态为不可用），恢复后自动开放" },
  { id: "bare", displayName: "无原因", enabled: false },
];
async function profile(props: Record<string, unknown>) {
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Profile, { t: zh, rows: ROWS as never, selected: "", saving: false, rolledBack: false, error: false, onChange: () => {}, onRetry: () => {}, ...props } as never)));
  return { container, close: () => React.act(async () => root.unmount()) };
}

test("G-2: the preset stale notice keeps its warning and appends Core's reason", async () => {
  const v = await profile({ selected: "deep", stale: "深度思考", staleReason: "原生参数映射尚未验证，不能静默降档" });
  try {
    const notice = v.container.querySelector("[data-testid=mc-preset-stale]")!.textContent!;
    assert.ok(notice.startsWith("「深度思考」暂时不能使用，本轮使用默认设置。"), notice);
    assert.ok(notice.includes("原生参数映射尚未验证，不能静默降档"), notice);
  } finally { await v.close(); }
  const plain = await profile({ selected: "deep", stale: "深度思考" });
  try { assert.equal(plain.container.querySelector("[data-testid=mc-preset-stale]")!.textContent, "「深度思考」暂时不能使用，本轮使用默认设置。"); } finally { await plain.close(); }
});

// ---- G-3: a disabled preset row shows its own Core reason (model_profile.go:26) instead of a fixed 暂未开放 ----
test("G-3: a kept disabled preset shows Core's reason; it stays disabled; no reason falls back to 暂未开放", async () => {
  for (const [id, reason] of [["img", "上游当前不可用（网关模型状态为不可用），恢复后自动开放"], ["long-context", "暂未开放"], ["bare", "暂未开放"]]) {
    const v = await profile({ selected: id });
    try {
      const radio = [...v.container.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]")].find((b) => b.textContent!.includes(ROWS.find((r) => r.id === id)!.displayName))!;
      assert.ok(radio, `${id} listed because it is current`);
      assert.equal(radio.disabled, true, "still not clickable");
      assert.ok(radio.textContent!.includes(`（${reason}）`), radio.textContent!);
      assert.equal(radio.title, reason);
    } finally { await v.close(); }
  }
});

// ---- G-6: a listed non-ready tool names its catalog reason (toolselect.go:158-181) ----
test("G-6: toolReasonText maps every catalog reason to plain zh, shows unknown text verbatim, 暂未开放 when absent", () => {
  const say = (r?: string) => grants.toolReasonText(r, zh);
  assert.equal(say("source_removed"), "来源已移除");
  assert.equal(say("conflict"), "同步冲突");
  assert.equal(say("not_admitted"), "未准入");
  assert.equal(say("engine_tools_disabled"), "导入工具未开启");
  assert.equal(say("held"), "同步暂停");
  assert.equal(say("manual_disabled"), "已停用");
  assert.equal(say("不支持"), "不支持", "Core's own zh text is kept");
  assert.equal(say(""), "暂未开放");
  assert.equal(say(undefined), "暂未开放");
  for (const r of ["held", "source_removed", "conflict", "not_admitted", "engine_tools_disabled", "manual_disabled"]) assert.ok((EN_STRINGS as Record<string, string>)[`toolReason_${r}`], `${r} en`);
});
