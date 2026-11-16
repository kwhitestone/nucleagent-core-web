import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";
import { effortView } from "../src/chat-react/requestEffort.ts";

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

before(async () => {
  dom = new JSDOM("<div id='root'></div>");
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, MutationObserver: dom.window.MutationObserver });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime({ http: {
    get: async () => { fetched += 1; return { data: { data: [
      { id: "quick", displayName: "快速", enabled: true },
      { id: "thinking", displayName: "思考", enabled: true },
      { id: "long-context", displayName: "长上下文", enabled: false, reason: "unsupported" },
    ] } }; },
    post: async (_url: string, body: unknown) => { sent = body; return { data: { data: { id: 9 } } }; },
  } });
  api = await vite.ssrLoadModule("/src/addons/conversation/api/conversation.ts");
  app = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx") as typeof app;
  React = await import("react");
  ({ createRoot } = await import("react-dom/client"));
});
after(async () => { unregister?.(); await vite?.close(); dom?.window.close(); });

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
      ["长上下文（unsupported）", "false", true, "mc-menu-item", -1],
    ]);
    assert.match(container.textContent!, /chatReact\.profileNote/);
    // The panel's own keyboard handling reaches the slot items and skips the disabled one.
    radios[3]!.focus();
    await React.act(async () => radios[3]!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    assert.equal(document.activeElement, radios[4]);
    await React.act(async () => radios[4]!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "End", bubbles: true })));
    assert.equal(document.activeElement, radios[6]);
    await React.act(async () => radios[6]!.click());
    await React.act(async () => radios[7]!.click());
    await React.act(async () => radios[4]!.click());
    assert.deepEqual(selected, [{ scope, profileId: "thinking" }, { scope, profileId: "" }]);
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
