import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";
import { effortView, sentEffort } from "../src/chat-react/requestEffort.ts";
import { profileEffortView, profileRequest, type ProfileSelection } from "../src/chat-react/modelProfile.ts";

// MUYU-408 on MUYU-406: profile choices are slot content of the one Controls panel, loaded on its first open.
let vite: ViteDevServer;
let unregister: () => void;
let dom: JSDOM;
let api: typeof import("../src/addons/conversation/api/conversation.ts");
let app: typeof import("../src/chat-react/ChatApp.tsx");
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let sent: unknown;
let fetched = 0;
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
    get: async () => { fetched += 1; return { data: { data: await catalog() } }; },
    post: async (_url: string, body: unknown) => { sent = body; return { data: { data: { id: 9 } } }; },
  } });
  api = await vite.ssrLoadModule("/src/addons/conversation/api/conversation.ts");
  app = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx") as typeof app;
  React = await import("react");
  ({ createRoot } = await import("react-dom/client"));
});
after(async () => { unregister?.(); await vite?.close(); dom?.window.close(); });

test("an unmeasured model keeps the default profile usable while effort stays disabled", async () => {
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  const original = catalog;
  const originalFetched = fetched;
  catalog = async () => [
    { id: "quick", displayName: "快速", enabled: false, efforts: [], reason: "当前模型/原生后端尚无已验证参数支持" },
    { id: "thinking", displayName: "思考", enabled: false, efforts: [], reason: "当前模型/原生后端尚无已验证参数支持" },
    { id: "long-context", displayName: "长上下文", enabled: false, efforts: [], reason: "原生链尚无可验证的每轮上下文窗口参数" },
  ];
  let selected: ProfileSelection | undefined;
  try {
    await React.act(async () => root.render(React.createElement(app.ModelControls, {
      t: (key) => key, value: "", view: effortView("codex", undefined), onChange: () => {}, defaultOpen: true,
    }, React.createElement(app.ProfileSlot, {
      t: (key) => key, backend: "codex", model: "", scope: "default", value: null, disabled: false,
      onChange: (value) => { selected = value; },
    }))));
    for (let attempt = 0; attempt < 20 && container.querySelectorAll("[role=menuitemradio]").length < 8; attempt++) {
      await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    }
    const radios = [...container.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]")];
    assert.equal(radios.length, 8);
    assert.ok(radios.slice(0, 4).every((radio) => radio.disabled));
    assert.equal(radios[4]!.disabled, false);
    assert.ok(radios.slice(5).every((radio) => radio.disabled));
    assert.doesNotMatch(container.innerHTML, /未验证|已验证参数|原生链|原生后端/);
    assert.match(container.textContent!, /chatReact.optionUnavailable/);
    await React.act(async () => radios[4]!.click());
    assert.equal(selected?.profileId, "");
  } finally { catalog = original; await React.act(async () => root.unmount()); fetched = originalFetched; }
});

test("profiles are radio items of the single Controls menu and are fetched on its first open", async () => {
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  const scope = "9:codex:7:gpt-6-astra";
  const selected: unknown[] = [];
  const t = (key: string) => key;
  try {
    await React.act(async () => root.render(React.createElement(app.ModelControls, {
      t, value: "", view: effortView("codex", { levels: ["low", "medium", "high"], effective: true, source: "fixture" }), onChange: () => {},
    }, React.createElement(app.ProfileSlot, {
      t, backend: "codex", providerId: 7, model: "gpt-6-astra", scope, value: { scope, profileId: "quick" },
      onChange: (value: unknown) => { selected.push(value); },
    }))));
    assert.equal(fetched, 0, "closed panel: no /model-profiles request");
    assert.equal(container.querySelectorAll("[role=menuitemradio]").length, 4, "effort radios only");
    await React.act(async () => container.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")!.click());
    for (let i = 0; i < 20 && container.querySelectorAll("[role=menuitemradio]").length < 8; i++) {
      await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    }
    assert.equal(fetched, 1);
    // One entry, one panel; none of the old standalone shell or its duplicate effort control.
    assert.equal(container.querySelectorAll(".mc-controls").length, 1);
    assert.equal(container.querySelectorAll("[role=menu]").length, 1);
    assert.equal(container.querySelector("aside, details, select, .mc-controls-toggle"), null);
    const radios = [...container.querySelectorAll<HTMLButtonElement>("[role=menu] [role=menuitemradio]")];
    assert.deepEqual(radios.slice(4).map((radio) => [radio.textContent, radio.getAttribute("aria-checked"), radio.disabled, radio.className, radio.tabIndex]), [
      ["chatReact.effortDefault", "false", false, "mc-menu-item", -1],
      ["快速", "true", false, "mc-menu-item", -1],
      ["思考", "false", false, "mc-menu-item", -1],
      ["长上下文（chatReact.optionUnavailable）", "false", true, "mc-menu-item", -1],
    ]);
    assert.match(container.textContent!, /chatReact\.profileNote/);
    const group = radios[4]!.closest("[role=group]")!;
    assert.equal(document.getElementById(group.getAttribute("aria-labelledby")!)!.textContent, "chatReact.profile");
    assert.equal(group.querySelectorAll("[role=menuitemradio]").length, 4, "profiles form their own radio group");
    // The panel's own keyboard handling reaches the slot items and skips the disabled one.
    radios[3]!.focus();
    await React.act(async () => radios[3]!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    assert.equal(document.activeElement, radios[4]);
    await React.act(async () => radios[4]!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "End", bubbles: true })));
    assert.equal(document.activeElement, radios[6]);
    await React.act(async () => radios[6]!.click());
    await React.act(async () => radios[7]!.click());
    await React.act(async () => radios[4]!.click());
    assert.deepEqual(selected, [{ scope, profileId: "thinking", efforts: ["low", "medium", "high"] }, { scope, profileId: "", efforts: undefined }]);
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

test("effort radios follow the selected profile whitelist across profile, model and async catalog changes", async () => {
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  const t = (key: string) => key;
  const evidence = effortView("codex", { levels: ["low", "medium", "high"], effective: true, source: "fixture" });
  const profiles = [
    { id: "narrow", displayName: "narrow", enabled: true, efforts: ["low", "high"] },
    { id: "full", displayName: "full", enabled: true, efforts: ["low", "medium", "high"] },
    { id: "bare", displayName: "bare", enabled: true },
    { id: "none", displayName: "none", enabled: true, efforts: [] },
  ];
  catalog = async () => profiles;
  let turn: unknown;
  // The same three lines ChatApp uses, with "medium" as the remembered choice for the model.
  function Harness({ model }: { model: string }) {
    const scope = `9:codex:7:${model}`;
    const [profile, setProfile] = React.useState<ProfileSelection | null>(null);
    const view = profileEffortView(evidence, profile, scope);
    const sent = sentEffort("medium", view);
    turn = profileRequest(profile, scope, sent);
    return React.createElement(app.ModelControls, { t, value: sent, view, onChange: () => {}, defaultOpen: true },
      React.createElement(app.ProfileSlot, { t, backend: "codex", providerId: 7, model, scope, value: profile, onChange: setProfile }));
  }
  const radios = () => [...container.querySelectorAll<HTMLButtonElement>("[role=menu] [role=menuitemradio]")];
  // default/low/medium/high: "-" disabled, "*" checked.
  const efforts = () => radios().slice(0, 4).map((radio) => `${radio.disabled ? "-" : "+"}${radio.getAttribute("aria-checked") === "true" ? "*" : ""}`);
  const settle = async (count: number) => {
    for (let i = 0; i < 20 && radios().length !== count; i++) await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    assert.equal(radios().length, count);
  };
  const choose = (name: string) => React.act(async () => radios().find((radio) => radio.textContent === name)!.click());
  const OPEN = ["+", "+", "+*", "+"];
  try {
    await React.act(async () => root.render(React.createElement(Harness, { model: "gpt-6-astra" })));
    await settle(9);
    assert.deepEqual([efforts(), turn], [OPEN, "medium"], "no profile: evidence view only");
    await choose("narrow");
    assert.deepEqual([efforts(), turn], [["+*", "+", "-", "+"], { profileId: "narrow" }], "medium is outside this profile's whitelist");
    await choose("full");
    assert.deepEqual([efforts(), turn], [OPEN, { profileId: "full", modelParams: { reasoningEffort: "medium" } }]);
    for (const unknown of ["bare", "none"]) {
      await choose(unknown);
      assert.deepEqual([efforts(), turn], [["+*", "-", "-", "-"], { profileId: unknown }], "unknown or empty whitelist: nothing is offered or sent");
    }
    // Model switch: the old selection is ignored at once, and nothing of the new catalog shows until it arrives.
    let release!: () => void;
    catalog = () => new Promise((resolve) => { release = () => resolve(profiles.slice(0, 1)); });
    await React.act(async () => root.render(React.createElement(Harness, { model: "other" })));
    await settle(5);
    assert.deepEqual([efforts(), turn], [OPEN, "medium"]);
    await React.act(async () => release());
    await settle(6);
    assert.deepEqual([efforts(), turn], [OPEN, "medium"], "a catalog that arrives late selects nothing by itself");
    await choose("narrow");
    assert.deepEqual([efforts(), turn], [["+*", "+", "-", "+"], { profileId: "narrow" }]);
    catalog = async () => profiles;
    await React.act(async () => root.render(React.createElement(Harness, { model: "gpt-6-astra" })));
    await settle(9);
    assert.deepEqual([efforts(), turn], [OPEN, "medium"], "a selection made for another model is not carried back");
  } finally { await React.act(async () => root.unmount()); }
});
