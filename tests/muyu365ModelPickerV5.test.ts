import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";

// MUYU-365 picker-model: the V5 model picker (protomedia-v5/proto/index.html, REPORT.md). The model list is the main
// entry. The executor is a folded secondary setting showing per-executor model counts. Executor switches never swap the
// model silently. Names are complete (wrapped in the list, middle-ellipsis on the button). The selection is checked and
// scrolled to. The provider is metadata only. Empty states are explicit.
let vite: ViteDevServer;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let app: typeof import("../src/chat-react/ChatApp.tsx");
let groupsMod: typeof import("../src/chat-react/modelGroups.ts");
let dom: JSDOM;
const t = (key: string) => key;
const scrolled: Element[] = [];
before(async () => {
  dom = new JSDOM("<div id='root'></div>", { url: "https://test.example/" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: dom.window.localStorage });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, MutationObserver: dom.window.MutationObserver });
  dom.window.Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this); };
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  React = await import("react");
  ({ createRoot } = await import("react-dom/client"));
  app = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx") as typeof app;
  groupsMod = await vite.ssrLoadModule("/src/chat-react/modelGroups.ts") as typeof groupsMod;
});
after(async () => { await vite?.close(); });

const chat = (model: string, over: Record<string, unknown> = {}) => ({ value: `chat:1:${model}`, label: model, hint: "目鱼网关", upstream: "云一/everai", choice: { kind: "chat" as const, model: { providerId: 1, model } }, ...over });
const exec = (id: string, label: string) => ({ value: `executor:${id}`, label, choice: { kind: "executor" as const, backend: id } });
const LONG = "doubao-seed-2-1-pro-260915";
const CHAT = [chat("MiniMax-M3.1-Flash"), chat(LONG), chat("doubao-seed-2-1-lite-260915"), ...Array.from({ length: 40 }, (_, i) => chat(`filler-${i}`)),
  chat("deepseek-v4-1-flash-260910"), chat("deepseek-v4-1-pro-260910"), chat("claude-only")];
const EXECS = [exec("codex", "Codex Agent"), exec("claude-code", "Claude Code"), exec("edge", "Edge 本地")];
const GROUPS = [{ kind: "chat" as const, options: CHAT }, { kind: "executor" as const, options: EXECS }];
// Synthetic compatibility: codex runs everything but claude-only; claude-code runs only claude-only; edge runs nothing.
const fits = (choice: { kind: string; model?: { model: string } }, backend: string) =>
  choice.kind !== "chat" || (backend === "codex" ? choice.model!.model !== "claude-only" : backend === "claude-code" ? choice.model!.model === "claude-only" : false);

async function render(props: Record<string, unknown> = {}) {
  scrolled.length = 0;
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  const picked: unknown[] = [];
  const draw = (over: Record<string, unknown> = {}) => {
    const all = { ...props, ...over } as { backend?: string };
    const backend = all.backend ?? "codex";
    return React.createElement(app.ModelMenu as never, { t, groups: GROUPS, value: "chat:1:deepseek-v4-1-flash-260910", backend, disabled: false,
      onPick: (c: unknown) => picked.push(c), compatible: (c: never) => fits(c, backend), compatibleWith: fits, ...all });
  };
  await React.act(async () => root.render(draw()));
  const q = <E extends Element = HTMLElement>(s: string) => container.querySelector<E & HTMLElement>(s);
  const all = <E extends Element = HTMLElement>(s: string) => [...container.querySelectorAll<E & HTMLElement>(s)];
  const trigger = q<HTMLButtonElement>("[data-testid=mc-model]")!;
  const options = () => all("[data-testid=mc-model-menu] [role=option]");
  return { container, root, picked, q, all, trigger, options, rerender: (over: Record<string, unknown>) => React.act(async () => root.render(draw(over))),
    open: () => React.act(async () => trigger.click()), click: (el: Element) => React.act(async () => (el as HTMLElement).click()), close: () => React.act(async () => root.unmount()) };
}

test("V5: no executor segments on top; executors fold at the bottom as 「执行器（高级设置）· 当前值」 with per-executor model counts", async () => {
  const v = await render();
  try {
    await v.open();
    assert.equal(!!v.q("[data-testid=mc-executors]"), false, "segmented executor tabs are gone");
    assert.equal(!!v.q(".mc-segments"), false);
    const engine = v.q<HTMLDetailsElement>("[data-testid=mc-engine]")!;
    assert.ok(engine, "secondary executor entry exists");
    assert.equal(engine.tagName, "DETAILS");
    assert.equal(engine.open, false, "folded by default");
    const list = v.q("[role=listbox]")!;
    assert.ok(list.compareDocumentPosition(engine) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, "below the model list");
    const summary = engine.querySelector("summary")!.textContent!;
    assert.match(summary, /chatReact\.engineSummary/);
    assert.match(summary, /Codex Agent/, "shows the current executor");
    const rows = v.all("[data-testid=mc-engine-option]");
    assert.deepEqual(rows.map((r) => r.getAttribute("data-count")), ["45", "1", "0"], "listable models per executor (default row not counted)");
    assert.deepEqual(rows.map((r) => r.getAttribute("aria-pressed")), ["true", "false", "false"]);
    assert.match(rows[2]!.textContent!, /chatReact\.engineNone/);
    assert.match(rows[0]!.textContent!, /chatReact\.engineCount/);
  } finally { await v.close(); }
});

test("V5: switching to an incompatible executor keeps the model on the button, warns with the names, offers 切回; nothing is picked silently", async () => {
  const v = await render();
  try {
    await v.open();
    await v.click(v.q("[data-testid=mc-engine] summary")!);
    await v.click(v.all("[data-testid=mc-engine-option]")[1]!);
    assert.deepEqual(v.picked, [EXECS[1]!.choice], "only the executor is picked, no model");
    await v.rerender({ backend: "claude-code" });
    assert.match(v.trigger.textContent!, /deepseek-v4-1-/, "the old model stays on the button");
    assert.ok(v.trigger.hasAttribute("data-stale"));
    const notice = v.q("[data-testid=mc-engine-mismatch]")!;
    assert.ok(notice, "explicit mismatch notice");
    assert.equal(notice.getAttribute("role"), "status");
    assert.match(notice.textContent!, /chatReact\.engineMismatch/);
    assert.equal(!!v.q("[data-testid=mc-model-stale]"), false, "not the generic 当前模型已不可用 text");
    const back = v.q<HTMLButtonElement>("[data-testid=mc-engine-back]")!;
    assert.ok(back, "切回 offered");
    await v.click(back);
    assert.deepEqual(v.picked.at(-1), EXECS[0]!.choice, "切回 picks the first executor that runs the model");
  } finally { await v.close(); }
});

test("V5: list rows show the full name (wrapping) with a leading check column; provider is a small second line; no fixed upstream badge", async () => {
  const v = await render();
  try {
    await v.open();
    assert.equal(!!v.q("[data-testid=mc-upstream]"), false, "redundant per-row upstream badge removed");
    const row = v.options().find((o) => o.querySelector(".mc-menu-name")?.textContent === LONG)!;
    assert.ok(row, "full name rendered as is");
    assert.equal(row.querySelector(".mc-menu-provider")!.textContent, "目鱼网关", "provider below the name");
    const selected = v.options().find((o) => o.getAttribute("aria-selected") === "true")!;
    assert.ok(selected.querySelector(".mc-menu-check svg"), "check on the selected row");
    assert.equal(!!row.querySelector(".mc-menu-check svg"), false);
    assert.ok(row.querySelector(".mc-menu-check"), "check column kept for alignment");
    const css = readFileSync("src/chat-react/chat.css", "utf8");
    assert.match(css, /\.mc-menu-name \{[^}]*overflow-wrap: anywhere/);
    assert.match(css, /\.mc-menu-name \{[^}]*white-space: normal/);
    assert.match(css, /\.mc-model-picker \.mc-menu-item\[aria-selected="true"\] \{[^}]*background/, "selected row has its own look");
  } finally { await v.close(); }
});

test("V5: opening scrolls to the current model and makes it the active option, even past the first page", async () => {
  const v = await render();
  try {
    await v.open();
    const selected = v.options().find((o) => o.getAttribute("aria-selected") === "true")!;
    assert.ok(selected, "the selected row is rendered although it sits past row 32");
    assert.ok(scrolled.includes(selected), "scrolled into view");
    const input = v.q<HTMLInputElement>("[data-testid=mc-model-search]")!;
    assert.equal(input.getAttribute("aria-activedescendant"), selected.id, "keyboard starts from the current model");
    assert.equal(document.activeElement, input, "search still focused");
  } finally { await v.close(); }
});

test("V5: the button shows a middle ellipsis keeping the distinguishing tail; title and aria carry the full name and executor", async () => {
  const v = await render();
  try {
    assert.equal(v.q(".mc-model-head")!.textContent, "deepseek-v4-1-");
    assert.equal(v.q(".mc-model-tail")!.textContent, "flash-260910");
    assert.equal(!!v.q(".mc-model-exec"), false, "executor no longer squeezes the name on the button");
    assert.match(v.trigger.title, /deepseek-v4-1-flash-260910/);
    assert.match(v.trigger.getAttribute("aria-label")!, /deepseek-v4-1-flash-260910 · .*Codex Agent/);
    const css = readFileSync("src/chat-react/chat.css", "utf8");
    assert.match(css, /\.mc-model-head \{[^}]*text-overflow: ellipsis/);
    assert.match(css, /\.mc-model-tail \{[^}]*flex: none/);
  } finally { await v.close(); }
});

test("splitName: tail starts where the name first differs from a look-alike, aligned to '-'; a lone name keeps its last segment(s)", () => {
  const { splitName } = groupsMod;
  assert.deepEqual(splitName("deepseek-v4-1-flash-260910", ["deepseek-v4-1-pro-260910", "deepseek-v4-1-flash-260910"]), ["deepseek-v4-1-", "flash-260910"]);
  assert.deepEqual(splitName(LONG, [LONG, "doubao-seed-2-1-lite-260915"]), ["doubao-seed-2-1-", "pro-260915"]);
  assert.deepEqual(splitName(LONG, [LONG]), ["doubao-seed-2-1-", "pro-260915"]);
  assert.deepEqual(splitName("hy4", ["hy4"]), ["", "hy4"]);
  const [head, tail] = splitName("gpt-6.2-astra", ["gpt-6.2-sol"]);
  assert.equal(head + tail, "gpt-6.2-astra");
  assert.ok(tail.includes("astra"), "the differing part is inside the kept tail");
});

test("V5: an executor with no model shows an explicit empty state with 更换执行器 (which opens the fold); a failed search says 没有匹配", async () => {
  const v = await render({ backend: "edge", value: "" });
  try {
    await v.open();
    const empty = v.q("[data-testid=mc-model-empty]")!;
    assert.ok(empty, "empty state shown");
    assert.match(empty.textContent!, /chatReact\.noModelsFor/);
    assert.equal(v.q<HTMLDetailsElement>("[data-testid=mc-engine]")!.open, false);
    await v.click(v.q("[data-testid=mc-engine-open]")!);
    assert.equal(v.q<HTMLDetailsElement>("[data-testid=mc-engine]")!.open, true, "更换执行器 expands the executor setting");
    assert.equal(v.trigger.querySelector(".mc-model-tail")!.textContent, "chatReact.noModels", "button says 无可用模型");
  } finally { await v.close(); }
});

test("V5: composer send is disabled up front while the model does not fit the executor, with the reason shown", () => {
  const src = readFileSync("src/chat-react/ChatApp.tsx", "utf8");
  assert.match(src, /const mismatch = !settings\.media && settings\.allowed === false/);
  assert.match(src, /const blocked = [^;]*mismatch/);
  assert.match(src, /data-testid="mc-engine-blocked"/);
});

test("pickPlan: an executor that does not fit the model is taken locally (never PATCHed, never refused); a fitting pick saves", () => {
  const { pickPlan } = groupsMod;
  assert.equal(pickPlan({ kind: "executor", backend: "claude-code" }, false), "local");
  assert.equal(pickPlan({ kind: "executor", backend: "codex" }, true), "save");
  assert.equal(pickPlan({ kind: "chat", model: { providerId: 1, model: "x" } }, true), "save");
  assert.equal(pickPlan({ kind: "chat", model: { providerId: 1, model: "x" } }, false), "refuse", "a model Core would refuse is still refused");
  assert.equal(pickPlan(null, true), "save");
});

test("AVAILABILITY P-1: a thinking level Core declares status \"supported\" is selectable (Core model_capability.go:201); unverified / policy_forbidden are not", async () => {
  const sel = await vite.ssrLoadModule("/src/chat-react/modelSelection.ts") as typeof import("../src/chat-react/modelSelection.ts");
  const cap = { model: "gpt-6.2-astra", capability_revision: 7, protocols: { responses: { selectable: true, thinking_levels: {
    off: { status: "policy_forbidden", reason_code: "policy_forbidden", reason: "此版本按产品策略不可关闭思考" }, low: { status: "supported" }, medium: { status: "unverified", reason: "未验证" }, high: { status: "supported" } } } } };
  const view = sel.capabilityView(cap, "codex", { model: "gpt-6.2-astra" });
  assert.equal(view.state, "visible");
  if (view.state !== "visible") return;
  assert.deepEqual(view.protocols[0]!.levels.map((l) => [l.level, l.selectable]), [["off", false], ["low", true], ["medium", false], ["high", true]]);
  // The prod preset shape (Core model_profile.go:118-122): callProtocol responses + a supported level → sent, not stale.
  const preset = sel.presetFields(view, { reasoningEffort: "high", callProtocol: "responses", thinkingLevel: "high" }, { profileId: "thinking" });
  assert.equal(preset.stale, false);
  assert.deepEqual(preset.fields, { modelSelection: { callProtocol: "responses", thinkingLevel: "high", capabilityRevision: 7 } });
});
