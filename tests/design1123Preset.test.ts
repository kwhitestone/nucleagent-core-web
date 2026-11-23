import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";

// design-1123 A: the input area keeps only presets; protocol + level ride inside the preset (phase 1 = P2 "C").
const declaration = { model: "m", capability_revision: 7, protocols: {
  responses: { selectable: true, thinking_levels: { off: { status: "verified" }, high: { status: "verified" }, low: { status: "unverified" } } },
  messages: { selectable: false, reason: "上游协议不支持" },
} };
let sel: typeof import("../src/chat-react/modelSelection.ts");
const views = () => ({ visible: sel.capabilityView(declaration, "codex", { model: "m" }), hidden: sel.capabilityView(undefined, "codex") });

test("a preset with a selectable protocol + level sends modelSelection only", () => {
  const { visible } = views(); const presetFields = sel.presetFields;
  assert.deepEqual(presetFields(visible, { callProtocol: "responses", thinkingLevel: "high" }, { profileId: "deep" }),
    { fields: { modelSelection: { callProtocol: "responses", thinkingLevel: "high", capabilityRevision: 7 } }, stale: false });
  assert.deepEqual(presetFields(visible, { callProtocol: "responses" }, { profileId: "deep" }).fields,
    { modelSelection: { callProtocol: "responses", thinkingLevel: null, capabilityRevision: 7 } });
});

test("a stale preset (combination not selectable, or no declaration) sends only profileId and says so", () => {
  const { visible, hidden } = views(); const presetFields = sel.presetFields;
  for (const [view, params] of [[visible, { callProtocol: "messages" }], [visible, { callProtocol: "responses", thinkingLevel: "low" }], [hidden, { callProtocol: "responses" }]] as [ReturnType<typeof views>["visible"], Record<string, string>][]) {
    assert.deepEqual(presetFields(view, params, { profileId: "deep", modelParams: { reasoningEffort: "high" } }), { fields: { profileId: "deep" }, stale: true });
  }
});

test("a preset without protocol/level and the default keep today's fields", () => {
  const { visible, hidden } = views(); const presetFields = sel.presetFields;
  assert.deepEqual(presetFields(hidden, { reasoningEffort: "low" }, { profileId: "quick" }), { fields: { profileId: "quick" }, stale: false });
  assert.deepEqual(presetFields(visible, undefined, ""), { fields: "", stale: false });
  assert.deepEqual(presetFields(hidden, undefined, "medium"), { fields: "medium", stale: false });
});

let vite: ViteDevServer;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let app: typeof import("../src/chat-react/ChatApp.tsx");
let Profile: typeof import("../src/chat-react/ProfileControls.tsx").default;
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
  sel = await vite.ssrLoadModule("/src/chat-react/modelSelection.ts") as typeof sel;
});
after(async () => { await vite?.close(); });

const ROWS = [
  { id: "think", displayName: "思考", enabled: true, params: { thinkingLevel: "medium" } },
  { id: "deep", displayName: "深度思考", enabled: true, params: { callProtocol: "responses", thinkingLevel: "high" } },
  { id: "gone", displayName: "停用", enabled: false },
];
async function render(props: { selected?: string; name?: string; stale?: string; rows?: unknown[] }) {
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  const picked: string[] = [];
  const page = React.createElement(Profile, { t: (key: string) => key, rows: (props.rows ?? ROWS) as never, selected: props.selected ?? "", saving: false, rolledBack: false, error: false,
    stale: props.stale, onChange: (id: string) => picked.push(id), onRetry: () => {} });
  await React.act(async () => root.render(React.createElement(app.ModelControls as never, { t: (key: string) => key, profile: { name: props.name, stale: !!props.stale, page } })));
  const trigger = container.querySelector<HTMLButtonElement>(".mc-controls > [aria-haspopup=menu]")!;
  return { container, root, picked, trigger, open: async () => React.act(async () => trigger.click()) };
}

test("the 思考 pill opens the preset radios directly: no root rows, no protocol/level/effort pages, no 返回", async () => {
  const view = await render({});
  try {
    assert.equal(view.trigger.textContent, "chatReact.profile", "default shows 「预设」");
    await view.open();
    const menu = view.container.querySelector<HTMLElement>(".mc-controls [role=menu]")!;
    assert.equal(menu.hidden, false);
    assert.equal(view.container.querySelector("[data-testid^=mc-ctl-]"), null);
    assert.equal(view.container.querySelector("[data-testid=mc-effort-page],[data-testid=mc-protocol-page],[data-testid=mc-level-page]"), null);
    const radios = [...menu.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]")];
    assert.deepEqual(radios.map((r) => r.querySelector(".mc-menu-text")!.textContent), ["chatReact.selectionDefault", "思考", "深度思考"], "a disabled preset is not listed");
    assert.equal(document.activeElement, radios[0], "focus lands on the checked radio");
    await React.act(async () => radios[2]!.click());
    assert.deepEqual(view.picked, ["deep"]);
  } finally { await React.act(async () => view.root.unmount()); }
});

test("each preset shows one line: level · protocol (默认协议 when none)", async () => {
  const view = await render({});
  try {
    await view.open();
    const details = [...view.container.querySelectorAll("[data-testid=mc-preset-detail]")].map((d) => d.textContent);
    assert.deepEqual(details, ["chatReact.effort chatReact.effortMedium · chatReact.presetProtocolDefault", "chatReact.effort chatReact.effortHigh · responses"]);
  } finally { await React.act(async () => view.root.unmount()); }
});

test("pill shows the preset name; a stale preset gets ⚠ on the pill and a notice on top of the page", async () => {
  const view = await render({ selected: "deep", name: "深度思考", stale: "深度思考" });
  try {
    assert.match(view.trigger.textContent!, /深度思考/);
    assert.ok(view.trigger.querySelector("[data-testid=mc-profile-stale]"));
    await view.open();
    const first = view.container.querySelector(".mc-controls [role=menu] [role=group] > :not(.mc-menu-label)");
    assert.equal(first?.getAttribute("data-testid"), "mc-preset-stale", "notice sits above the radios");
    assert.match(first!.textContent!, /chatReact\.presetStale/);
  } finally { await React.act(async () => view.root.unmount()); }
});

test("a selected preset that became disabled stays listed (not silently swapped)", async () => {
  const view = await render({ selected: "gone", name: "停用" });
  try {
    await view.open();
    const texts = [...view.container.querySelectorAll("[role=menuitemradio] .mc-menu-text")].map((x) => x.textContent);
    assert.ok(texts.some((x) => x!.startsWith("停用")));
  } finally { await React.act(async () => view.root.unmount()); }
});
