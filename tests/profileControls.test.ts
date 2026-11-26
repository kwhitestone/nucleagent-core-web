import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";

// MUYU-408 on MUYU-406: profile choices are slot content of the one Controls panel, loaded on its first open.
let vite: ViteDevServer;
let unregister: () => void;
let dom: JSDOM;
let api: typeof import("../src/addons/conversation/api/conversation.ts");
let app: typeof import("../src/chat-react/ChatApp.tsx");
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let sent: unknown;
// Mirrors Core's /model-profiles rows; `efforts` is the per-profile whitelist for modelParams.reasoningEffort.
let catalog = async (): Promise<unknown[]> => [
  { id: "quick", displayName: "快速", enabled: true, efforts: ["low", "medium", "high"] },
  { id: "thinking", displayName: "思考", enabled: true, efforts: ["low", "medium", "high"] },
  { id: "long-context", displayName: "长上下文", enabled: false, reason: "unsupported", efforts: [] },
];

before(async () => {
  dom = new JSDOM("<div id='root'></div>");
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, MutationObserver: dom.window.MutationObserver });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime({ http: {
    get: async () => ({ data: { data: await catalog() } }),
    post: async (_url: string, body: unknown) => { sent = body; return { data: { data: { id: 9 } } }; },
  } });
  api = await vite.ssrLoadModule("/src/addons/conversation/api/conversation.ts");
  app = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx") as typeof app;
  Profile = (await vite.ssrLoadModule("/src/chat-react/ProfileControls.tsx")).default;
  React = await import("react");
  ({ createRoot } = await import("react-dom/client"));
});
after(async () => { unregister?.(); await vite?.close(); dom?.window.close(); });

// exp104: the 「预设」 page content (ProfileControls) as the Controls profile page; rows come from the preference hook.
const page = (props: { rows: unknown[]; selected?: string; onChange?(id: string): void }) => ({
  page: React.createElement(Profile, { t: (key: string) => key, rows: props.rows as never, selected: props.selected ?? "", saving: false, rolledBack: false, error: false,
    onChange: props.onChange ?? (() => {}), onRetry: () => {} }),
});
let Profile: typeof import("../src/chat-react/ProfileControls.tsx").default;

test("MUYU-365 p0c40 v2 (was thinking3): a disabled tier stays listed and disabled with Core's reason on its own line; non-tier rows and 默认/关闭 are not listed", async () => {
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  const rows = [
    { id: "quick", displayName: "快速", enabled: false, efforts: [], reason: "当前模型/原生后端尚无已验证参数支持" },
    { id: "long-context", displayName: "长上下文", enabled: false, efforts: [], reason: "原生链尚无可验证的每轮上下文窗口参数" },
  ];
  const selected: string[] = [];
  try {
    await React.act(async () => root.render(React.createElement(app.ModelControls, { t: (key) => key, defaultOpen: true, profile: page({ rows, onChange: (id) => selected.push(id) }) })));
    const radios = [...container.querySelectorAll<HTMLButtonElement>("[data-testid=mc-profile-page] [role=menuitemradio]")];
    assert.deepEqual(radios.map((r) => [r.querySelector(".mc-menu-text")!.textContent, r.querySelector("[data-testid=mc-preset-reason]")?.textContent, r.disabled]), [
      ["chatReact.tier_quick", "当前模型/原生后端尚无已验证参数支持", true],
    ], "long-context (not a tier) stays unlisted");
    await React.act(async () => radios[0]!.click());
    assert.deepEqual(selected, []);
  } finally { await React.act(async () => root.unmount()); }
});

test("profiles are the radio items of the single Controls menu, with their own group and keys", async () => {
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  const selected: string[] = [];
  const t = (key: string) => key;
  try {
    await React.act(async () => root.render(React.createElement(app.ModelControls, {
      t, profile: page({ rows: await catalog(), selected: "quick", onChange: (id) => selected.push(id) }),
    })));
    await React.act(async () => container.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")!.click());
    assert.equal(container.querySelectorAll(".mc-controls").length, 1);
    assert.equal(container.querySelectorAll("[role=menu]").length, 1);
    assert.equal(container.querySelector("aside, details, select, .mc-controls-toggle, [data-testid^=mc-ctl-]"), null);
    const radios = [...container.querySelectorAll<HTMLButtonElement>("[role=menu] [role=menuitemradio]")];
    assert.deepEqual(radios.map((radio) => [radio.querySelector(".mc-menu-text")!.textContent, radio.getAttribute("aria-checked"), radio.disabled, radio.className, radio.tabIndex]), [
      ["chatReact.tier_quick", "true", false, "mc-menu-item", -1],
      ["chatReact.tier_thinking", "false", false, "mc-menu-item", -1],
    ]);
    assert.match(container.textContent!, /chatReact\.profileNote/);
    const group = radios[0]!.closest("[role=group]")!;
    assert.equal(group.getAttribute("aria-label"), "chatReact.profile");
    assert.equal(document.activeElement, radios[0], "focus lands on the checked preset");
    await React.act(async () => radios[0]!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    assert.equal(document.activeElement, radios[1]);
    await React.act(async () => radios[1]!.click());
    await React.act(async () => radios[0]!.click());
    assert.deepEqual(selected, ["thinking"], "re-choosing the checked tier saves nothing");
    assert.equal(container.querySelector<HTMLElement>("[role=menu]")!.hidden, false, "choosing does not close the panel");
  } finally { await React.act(async () => root.unmount()); }
});

test("one request carries the profile fields or the legacy effort, never both", async () => {
  await api.followUp(9, "question", undefined, undefined, undefined, { profileId: "quick", modelParams: { reasoningEffort: "medium" } });
  assert.deepEqual(sent, { input: "question", profileId: "quick", modelParams: { reasoningEffort: "medium" } });
  await api.followUp(9, "legacy", undefined, undefined, undefined, "high");
  assert.deepEqual(sent, { input: "legacy", reasoningEffort: "high" });
  await api.followUp(9, "next");
  assert.deepEqual(sent, { input: "next" });
});
