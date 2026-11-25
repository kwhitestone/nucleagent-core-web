import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";

// design-1123 B + C: one pill 「模型 · 执行器 ▾」 opening a searchable grouped list (OWUI c38885a Selector.svelte:937-996,
// :1114 — combobox keeps focus, ↑↓ move, Enter picks, Esc closes; list max-height 18rem), an executor segmented control,
// 最近使用 per executor (local, 3), family groups, and rule C (unavailable / incompatible not listed; current kept stale).
let vite: ViteDevServer;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let app: typeof import("../src/chat-react/ChatApp.tsx");
let dom: JSDOM;
const t = (key: string) => key;
before(async () => {
  dom = new JSDOM("<div id='root'></div>", { url: "https://test.example/" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: dom.window.localStorage });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, MutationObserver: dom.window.MutationObserver });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  React = await import("react");
  ({ createRoot } = await import("react-dom/client"));
  app = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx") as typeof app;
});
after(async () => { await vite?.close(); });

const chat = (model: string, over: Record<string, unknown> = {}) => ({ value: `chat:1:${model}`, label: model, hint: "P", choice: { kind: "chat" as const, model: { providerId: 1, model } }, ...over });
const GROUPS = [
  { kind: "chat" as const, options: [chat("deepseek-v4"), chat("deepseek-v4-flash", { vision: "supported" }), chat("qwen3.5-plus", { unprobed: true }), chat("qwen-down", { unavailable: "upstream_offline" }), chat("claude-x")] },
  { kind: "image" as const, options: [{ value: "image:1:img", label: "img", choice: { kind: "image" as const, model: { providerId: 1, model: "img" } } }, { value: "image:1:gone", label: "gone", unavailable: "capacity", choice: { kind: "image" as const, model: { providerId: 1, model: "gone" } } }] },
  { kind: "executor" as const, options: [{ value: "executor:codex", label: "Codex", choice: { kind: "executor" as const, backend: "codex" } }, { value: "executor:claude-code", label: "Claude Code", choice: { kind: "executor" as const, backend: "claude-code" } }] },
];

async function render(props: Record<string, unknown> = {}) {
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  const picked: unknown[] = [];
  const draw = (over: Record<string, unknown> = {}) => React.createElement(app.ModelMenu as never, { t, groups: GROUPS, value: "chat:1:deepseek-v4", backend: "codex", disabled: false,
    onPick: (c: unknown) => picked.push(c), compatible: (c: { model?: { model: string } }) => c.model?.model !== "claude-x", ...props, ...over });
  await React.act(async () => root.render(draw()));
  const q = <E extends Element = HTMLElement>(s: string) => container.querySelector<E & HTMLElement>(s);
  const trigger = q<HTMLButtonElement>("[data-testid=mc-model]")!;
  const options = () => [...container.querySelectorAll<HTMLElement>("[data-testid=mc-model-menu] [role=option]")];
  const names = () => options().map((o) => o.querySelector(".mc-menu-name")!.textContent);
  const key = async (value: string) => { await React.act(async () => document.activeElement!.dispatchEvent(new window.KeyboardEvent("keydown", { key: value, bubbles: true }))); };
  const type = async (text: string) => {
    const input = q<HTMLInputElement>("[data-testid=mc-model-search]")!;
    await React.act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, text); input.dispatchEvent(new window.Event("input", { bubbles: true })); });
  };
  return { container, root, picked, q, trigger, options, names, key, type, rerender: (over: Record<string, unknown>) => React.act(async () => root.render(draw(over))),
    open: () => React.act(async () => trigger.click()), close: () => React.act(async () => root.unmount()) };
}

test("pill shows the model (MUYU-365 V5: executor in title/label, not on the pill) with the full name in its title", async () => {
  const v = await render();
  try {
    assert.equal(v.q(".mc-model-name")!.textContent, "deepseek-v4");
    assert.equal(!!v.q(".mc-model-exec"), false);
    assert.match(v.trigger.title, /deepseek-v4 · Codex/);
  } finally { await v.close(); }
});

test("rule C: unavailable and executor-incompatible models are not listed; 未核实 stays; media alike", async () => {
  const v = await render();
  try {
    await v.open();
    const names = v.names();
    for (const hidden of ["qwen-down", "claude-x", "gone"]) assert.equal(names.includes(hidden), false, hidden);
    for (const shown of ["deepseek-v4", "deepseek-v4-flash", "qwen3.5-plus", "img"]) assert.equal(names.includes(shown), true, shown);
    assert.match(v.options().find((o) => o.textContent!.includes("qwen3.5-plus"))!.textContent!, /chatReact\.availabilityUnprobed/);
    assert.match(v.options().find((o) => o.textContent!.includes("deepseek-v4-flash"))!.textContent!, /chatReact\.badgeVision/);
    assert.equal(v.container.querySelector("[data-testid=mc-unavailable]"), null, "no greyed reason rows");
  } finally { await v.close(); }
});

test("rule C: a current model that became unavailable stays on the pill with ⚠ and a notice; nothing is swapped", async () => {
  const v = await render({ value: "chat:1:qwen-down" });
  try {
    assert.ok(v.trigger.hasAttribute("data-stale"));
    assert.match(v.trigger.textContent!, /qwen-down/);
    await v.open();
    assert.match(v.q("[data-testid=mc-model-stale]")!.textContent!, /chatReact\.modelStale/);
    assert.equal(v.names().includes("qwen-down"), true, "kept in the list, marked");
    assert.deepEqual(v.picked, []);
  } finally { await v.close(); }
});

test("search box keeps focus; typing filters; ↑↓ move the active option; Enter picks; Esc closes back to the pill", async () => {
  const v = await render();
  try {
    await v.open();
    const input = v.q<HTMLInputElement>("[data-testid=mc-model-search]")!;
    assert.equal(document.activeElement, input, "focus in the search box (OWUI :958)");
    assert.equal(input.getAttribute("role"), "combobox");
    assert.match(v.q("[role=listbox]")!.getAttribute("style") ?? "" + getComputedStyle(v.q("[role=listbox]")!).maxHeight, /18rem/);
    await v.type("deep");
    assert.deepEqual(v.names(), ["deepseek-v4", "deepseek-v4-flash"]);
    const active = () => document.getElementById(input.getAttribute("aria-activedescendant") ?? "")?.querySelector(".mc-menu-name")!.textContent;
    assert.equal(active(), "deepseek-v4");
    await v.key("ArrowDown");
    assert.equal(active(), "deepseek-v4-flash");
    assert.equal(document.activeElement, input, "focus never leaves the box");
    await v.key("ArrowDown");
    assert.equal(active(), "deepseek-v4-flash", "clamped at the end");
    await v.key("ArrowUp");
    await v.key("Enter");
    assert.deepEqual(v.picked, [GROUPS[0]!.options[0]!.choice]);
    assert.equal(v.q("[data-testid=mc-model-menu]")!.hidden, true);
    assert.equal(document.activeElement, v.trigger);
    await v.open();
    await v.key("Escape");
    assert.equal(v.q("[data-testid=mc-model-menu]")!.hidden, true);
    assert.equal(document.activeElement, v.trigger);
    await v.open();
    await v.type("zzz");
    assert.match(v.q("[data-testid=mc-model-menu]")!.textContent!, /chatReact\.noResults/);
  } finally { await v.close(); }
});

test("executor setting (MUYU-365 V5 fold, was segments) switches the executor without closing; a lone executor shows no setting", async () => {
  const v = await render();
  try {
    await v.open();
    assert.equal(!!v.q("[data-testid=mc-executors]"), false);
    const seg = [...v.container.querySelectorAll<HTMLButtonElement>("[data-testid=mc-engine-option]")];
    assert.deepEqual(seg.map((b) => [b.querySelector(".mc-menu-name")!.textContent, b.getAttribute("aria-pressed")]), [["Codex", "true"], ["Claude Code", "false"]]);
    await React.act(async () => seg[1]!.click());
    assert.deepEqual(v.picked, [GROUPS[2]!.options[1]!.choice]);
    assert.equal(v.q("[data-testid=mc-model-menu]")!.hidden, false);
    await v.rerender({ groups: [GROUPS[0], { kind: "executor", options: [GROUPS[2]!.options[0]] }] });
    assert.equal(!!v.q("[data-testid=mc-engine]"), false);
  } finally { await v.close(); }
});

test("scroll reveals the rest of the backend order", async () => {
  const rows = Array.from({ length: 64 }, (_, i) => chat("choice-" + i));
  const v = await render({ groups: [{ kind: "chat", options: rows }] });
  try {
    await v.open();
    assert.deepEqual(v.names(), ["common.modelDefault", ...rows.slice(0,31).map(row => row.label)]);
    await React.act(async () => v.q("[role=listbox]")!.dispatchEvent(new window.Event("scroll")));
    assert.equal(v.names()[63], "choice-62");
  } finally { await v.close(); }
});

test("with an image attached, image-incapable models stay listed but blocked (MUYU-418 context limit)", async () => {
  const v = await render({ hasImage: true, groups: [{ kind: "chat", options: [chat("see", { vision: "supported" }), chat("blind", { vision: "unsupported" })] }], value: "chat:1:see" });
  try {
    await v.open();
    const blind = v.options().find((o) => o.textContent!.includes("blind"))!;
    assert.equal(blind.getAttribute("aria-disabled"), "true");
    assert.equal(blind.title, "chatReact.visionBlocked");
    await React.act(async () => blind.click());
    assert.deepEqual(v.picked, []);
  } finally { await v.close(); }
});

test("layout: desktop pill ≤220px with a middle ellipsis (MUYU-365 V5); ≤480px pill ≤150px, media pills icon-only, both popovers as bottom drawers", () => {
  const css = readFileSync("src/chat-react/chat.css", "utf8");
  assert.match(css, /\.mc-model-trigger \{[^}]*max-width: 220px/);
  assert.match(css, /\.mc-model-head \{[^}]*text-overflow: ellipsis/);
  const narrow = css.slice(css.indexOf("@media (max-width: 480px)"));
  assert.ok(css.includes("@media (max-width: 480px)"));
  assert.match(narrow, /\.mc-model-trigger \{[^}]*max-width: 150px/);
  assert.match(narrow, /\.mc-pill-text[^{]*\{[^}]*display: none/);
  assert.match(narrow, /\.mc-model-picker > \.mc-menu, \.mc-controls \.mc-menu \{[^}]*position: fixed;[^}]*bottom: 0/);
});
