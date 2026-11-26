import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";

// MUYU-365 thinking3 (user 2026-11-25): fixed three tiers 「关闭思考」「快速（低）」「深度思考（高）」, always listed in that order.
// A tier the server does not enable stays listed, disabled, with the server's reason (never hidden). Core has no `off`
// row today (model_profile.go:216; model_capability.go:166 off = native_parameter_unverified), so 关闭思考 is listed
// disabled with that fact — 默认 (no parameter) is never presented as off. The level in a label is the row's real
// reasoningEffort (Core maps 深度思考 to medium when high is not measured), not a fixed word.
let vite: ViteDevServer;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let app: typeof import("../src/chat-react/ChatApp.tsx");
let Profile: typeof import("../src/chat-react/ProfileControls.tsx").default;
let zh: Record<string, string>;
before(async () => {
  const dom = new JSDOM("<div id='root'></div>");
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, MutationObserver: dom.window.MutationObserver });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  React = await import("react");
  ({ createRoot } = await import("react-dom/client"));
  app = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx") as typeof app;
  Profile = (await vite.ssrLoadModule("/src/chat-react/ProfileControls.tsx")).default;
  zh = (await vite.ssrLoadModule("/src/chat-react/islandStringsZh.ts")).ZH_STRINGS as Record<string, string>;
});
after(async () => { await vite?.close(); });

// Real Core v0.1.100 rows (PROD /model-profiles, evidence/raw-prod.json).
const core = (enabled: boolean, deep = "high") => [
  { id: "quick", displayName: "快速", enabled, reason: enabled ? undefined : "暂未开放", params: { reasoningEffort: "low" } },
  { id: "thinking", displayName: "深入思考", enabled, reason: enabled ? undefined : "暂未开放", params: { reasoningEffort: deep } },
  { id: "long-context", displayName: "长上下文", enabled: false, reason: "暂未开放", params: {} },
  { id: "default", displayName: "默认", enabled: true, params: {} },
];
const t = (key: string) => zh[key.replace(/^chatReact\./, "")] ?? (key === "common.retry" ? "重试" : key);

async function render(rows: unknown[], selected = "") {
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  const picked: string[] = [];
  const page = React.createElement(Profile, { t, rows: rows as never, selected, saving: false, rolledBack: false, error: false,
    onChange: (id: string) => picked.push(id), onRetry: () => {} });
  await React.act(async () => root.render(React.createElement(app.ModelControls as never, { t, defaultOpen: true, profile: { page } })));
  const radios = () => [...container.querySelectorAll<HTMLButtonElement>("[data-testid=mc-profile-page] [role=menuitemradio]")];
  const texts = () => radios().map((r) => r.querySelector(".mc-menu-text")!.textContent);
  return { container, root, picked, radios, texts, close: () => React.act(async () => root.unmount()) };
}

// MUYU-365 p0c40 v2 (user 2026-11-26): only 快速 / 深度思考; Core's 默认/关闭/长上下文 rows are not shown.
test("only the two tiers in fixed order with the user's wording; Core's 默认 and other rows are not shown", async () => {
  const v = await render(core(true));
  try {
    assert.deepEqual(v.texts(), ["快速（低）", "深度思考（高）"]);
    assert.deepEqual(v.radios().map((r) => r.disabled), [false, false]);
    await React.act(async () => v.radios()[1]!.click());
    assert.deepEqual(v.picked, ["thinking"], "深度思考 saves Core's own id");
  } finally { await v.close(); }
});

test("disabled tiers stay listed with Core's reason on its own line (non-codex executors); none is pickable", async () => {
  const v = await render(core(false));
  try {
    assert.deepEqual(v.texts(), ["快速（低）", "深度思考（高）"]);
    assert.deepEqual(v.radios().map((r) => [r.disabled, r.querySelector("[data-testid=mc-preset-reason]")?.textContent, r.title]), [[true, "暂未开放", "暂未开放"], [true, "暂未开放", "暂未开放"]]);
  } finally { await v.close(); }
});

test("the label states the real mapped level: Core's 深度思考 at medium is shown as （中）, never （高）", async () => {
  const v = await render(core(true, "medium"));
  try { assert.equal(v.texts()[1], "深度思考（中）"); } finally { await v.close(); }
});

test("a server-provided off row is not shown, even when enabled", async () => {
  const off = { id: "off", displayName: "关闭", enabled: true, params: { reasoningEffort: "off" } };
  const v = await render([off, ...core(true)]);
  try { assert.deepEqual(v.texts(), ["快速（低）", "深度思考（高）"]); } finally { await v.close(); }
});

test("legacy saved long-context is not shown and nothing is checked in its place", async () => {
  const v = await render(core(true), "long-context");
  try {
    assert.deepEqual(v.texts(), ["快速（低）", "深度思考（高）"]);
    assert.equal(v.radios().some((r) => r.getAttribute("aria-checked") === "true"), false);
  } finally { await v.close(); }
});

test("non-chat catalogs (默认生成) get no thinking rows at all", async () => {
  const v = await render([{ id: "generate-default", displayName: "默认生成", enabled: true, params: {} }]);
  try { assert.deepEqual(v.texts(), []); } finally { await v.close(); }
});

test("the pill names the saved tier with the same wording", async () => {
  const { tierName } = await vite.ssrLoadModule("/src/chat-react/ProfileControls.tsx");
  assert.equal(tierName(core(true)[1], t), "深度思考（高）");
  assert.equal(tierName(core(true)[0], t), "快速（低）");
});
