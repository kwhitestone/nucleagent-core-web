// MUYU-365 exp104: the confirmed profile design (exp102/profile-design-review.html, user 2026-11-21 01a1fd03: D1A–D8A,
// pending items take the draft's recommended value). One Controls menu with two rows 「思考强度 ›」「预设 ›」, each
// opening its own page with 「‹ 返回」; S1–S8 states; bottom drawer on narrow screens. Real ChatApp + useModelPreference,
// only the HTTP boundary is a fixture. Assertions compare primitives only (exp101 resume-4 memory rule).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";

let vite: ViteDevServer;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let app: typeof import("../src/chat-react/ChatApp.tsx");
let disposeRuntime: () => void;
let disposeCatalog: () => void;
const t = (key: string) => key;

type Row = { id: string; displayName: string; enabled: boolean; efforts?: string[]; params?: Record<string, string>; reason?: string };
const PROFILES: Row[] = [
  { id: "quick", displayName: "快速", enabled: true, efforts: ["low"], params: { reasoningEffort: "low" } },
  { id: "thinking", displayName: "思考", enabled: true, efforts: ["low", "medium", "high"], params: { reasoningEffort: "high" } },
  { id: "long-context", displayName: "长上下文", enabled: false, efforts: [], params: {}, reason: "原生链尚无可验证的每轮上下文窗口参数" },
];
let profilesFor: (model: string) => Row[] = () => PROFILES;
let profileFailures = 0;
let putFailure: Error | null = null;
let putGate: Promise<void> | undefined;
const saved = new Map<string, { profileId: string; effort: string }>();
let puts: { model: string; profileId: string; effort: string }[] = [];
let profileReads: string[] = [];
const keyOf = (params: unknown) => JSON.stringify(params);

before(async () => {
  const dom = new JSDOM("", { url: "https://test.example/" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, MutationObserver: dom.window.MutationObserver, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), requestAnimationFrame: (run: () => void) => setTimeout(run, 0), cancelAnimationFrame: clearTimeout });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  React = await import("react");
  ({ createRoot } = await import("react-dom/client"));
  app = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx") as typeof app;
  const runtime = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  disposeRuntime = runtime.registerPlatformRuntime({ getAccessToken: () => "fixture", getSessionVersion: () => 1, http: {
    get: async (url: string, config?: { params?: { model?: string } }) => {
      const data = url.endsWith("execution-backends") ? [{ id: "codex", default: true }]
        : url.endsWith("model-selection") ? { executionBackend: "codex", providerId: 7, model: "gpt-6-astra", resolved: true }
        : url.endsWith("model-preferences") ? { ...(saved.get(keyOf(config?.params)) ?? { profileId: "", effort: "" }) }
        : url.endsWith("model-profiles") ? (() => {
          profileReads.push(config?.params?.model ?? "");
          if (profileFailures > 0) { profileFailures--; throw Object.assign(new Error("catalog down"), { status: 500 }); }
          return profilesFor(config?.params?.model ?? "");
        })()
        : /\/tool\/catalog(\?|$)/.test(url) ? []
        : url.endsWith("/bindings") ? { skillIds: [], toolIds: [], editable: true, revision: "1", principal: "11" }
        : /\/api\/v1\/files\?/.test(url) ? { owner: "user:11", items: [], hasMore: false }
        : /\/conversation\/9$/.test(url) ? { id: "9", providerId: 7, model: "gpt-6-astra", executionBackend: "codex", status: "completed" }
        : [];
      return { data: { data } };
    },
    put: async (_url: string, body: { profileId: string; effort: string }, config: { params: { model: string } }) => {
      puts.push({ model: config.params.model, ...body });
      await putGate;
      if (putFailure) throw putFailure;
      saved.set(keyOf(config.params), { ...body });
      return { data: { data: body } };
    },
    post: async () => { throw new Error("unexpected write"); },
    patch: async () => { throw new Error("unexpected write"); },
  } });
  const { registerModelCatalog } = await vite.ssrLoadModule("/src/contracts/model-catalog.ts");
  disposeCatalog = registerModelCatalog({
    listProviders: async () => [{ id: 7, name: "fixture", isActive: true, config: { models: ["gpt-6-astra", "deepseek-v4-flash"] } }],
    listTypedModels: async (type: string) => type === "chat" ? ["gpt-6-astra", "deepseek-v4-flash"].map((model) => ({ providerId: 7, model, type, capabilities: [] })) : [],
    fetchVisibleModels: async () => [],
  });
});
after(async () => { disposeCatalog?.(); disposeRuntime?.(); await vite?.close(); });

const settle = async () => { for (let turn = 0; turn < 8; turn++) await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const DEFAULT = keyOf({ executionBackend: "codex", providerId: 7, model: "gpt-6-astra" });

function reset() {
  profilesFor = () => PROFILES; profileFailures = 0; putFailure = null; putGate = undefined;
  saved.clear(); puts = []; profileReads = [];
}

async function mount(conversationId?: string) {
  const container = document.createElement("div");
  document.body.append(container);
  let root = createRoot(container);
  const created: Record<string, unknown>[] = [];
  const element = () => React.createElement(app.ChatApp, { t, strings: {} as never, conversationId, navigate: () => {},
    create: async (payload: Record<string, unknown>) => { created.push(payload); return { id: "55" } as never; } } as never);
  await React.act(async () => root.render(element()));
  await settle();
  const q = (selector: string) => container.querySelector<HTMLElement>(selector);
  const all = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)];
  const visible = (el: Element | null) => !!el && !el.closest("[hidden]");
  const click = async (el: HTMLElement | null) => { assert.equal(!!el, true, "element exists"); await React.act(async () => el!.click()); await settle(); };
  const controls = () => q('.mc-controls > [aria-haspopup=menu]') as HTMLButtonElement;
  const menu = () => q(".mc-controls [role=menu]")!;
  const page = (name: "profile" | "effort") => q(`[data-testid="mc-${name}-page"]`);
  const items = (name: "profile" | "effort") => [...(page(name)?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]") ?? [])];
  const checked = (name: "profile" | "effort") => items(name).filter((item) => item.getAttribute("aria-checked") === "true").map((item) => item.querySelector(".mc-menu-text")!.textContent).join("|");
  return {
    container, created, q, all, visible, click, controls, menu, page, items, checked,
    open: async () => { if (menu().hidden) await click(controls()); },
    openProfile: async () => { if (menu().hidden) await click(controls()); await click(q('[data-testid="mc-ctl-profile"]')); },
    openEffort: async () => { if (menu().hidden) await click(controls()); await click(q('[data-testid="mc-ctl-effort"]')); },
    choose: async (name: string) => click(items("profile").find((item) => item.querySelector(".mc-menu-text")!.textContent!.startsWith(name)) ?? null),
    key: async (value: string) => { await React.act(async () => (document.activeElement ?? menu()).dispatchEvent(new window.KeyboardEvent("keydown", { key: value, bubbles: true }))); await settle(); },
    send: async (text: string) => {
      const input = q("textarea") as HTMLTextAreaElement;
      await React.act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
        input.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
      await click(q('[data-testid="mc-send"]'));
    },
    remount: async () => { await React.act(async () => root.unmount()); root = createRoot(container); await React.act(async () => root.render(element())); await settle(); },
    close: async () => { await React.act(async () => root.unmount()); container.remove(); },
  };
}

test("D1A entry: Controls root lists 「思考强度 ›」 and 「预设 · 当前值 ›」; each opens its own page with 返回", { timeout: 30000 }, async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  reset();
  const view = await mount();
  try {
    await view.open();
    const effortRow = view.q('[data-testid="mc-ctl-effort"]');
    const profileRow = view.q('[data-testid="mc-ctl-profile"]');
    assert.equal(view.visible(effortRow), true, "effort row on the root page");
    assert.equal(view.visible(profileRow), true, "preset row on the root page");
    assert.match(effortRow!.textContent!, /chatReact\.effort.*›/);
    assert.match(profileRow!.textContent!, /chatReact\.profile.*chatReact\.effortDefault.*›/, "row shows its current value (默认)");
    assert.equal(view.visible(view.page("profile")), false, "second-level page closed until chosen");
    assert.equal(view.all(".mc-controls").length, 1, "still one Controls entry");
    await view.click(profileRow);
    assert.equal(view.visible(view.page("profile")), true);
    assert.equal(view.visible(view.q('[data-testid="mc-ctl-profile"]')), false, "root rows give way to the page");
    assert.equal(view.items("profile").map((item) => `${item.querySelector(".mc-menu-text")!.textContent}${item.disabled ? "-" : "+"}`).join("|"),
      "chatReact.profileDefault+|快速+|思考+|长上下文（chatReact.optionUnavailable）-", "默认（不使用预设）, Core presets, unavailable one disabled");
    assert.equal(view.checked("profile"), "chatReact.profileDefault");
    assert.match(view.page("profile")!.textContent!, /chatReact\.profileNote/);
    const back = view.q('[data-testid="mc-profile-page"] [data-testid="mc-ctl-back"]');
    assert.match(back!.textContent!, /chatReact\.back/);
    await view.click(back);
    assert.equal(view.visible(view.q('[data-testid="mc-ctl-profile"]')), true, "返回 goes to the root list");
    await view.click(view.q('[data-testid="mc-ctl-effort"]'));
    assert.equal(view.items("effort").length, 4, "默认/低/中/高 on the effort page");
    assert.equal(view.visible(view.q('[data-testid="mc-effort-page"] [data-testid="mc-ctl-back"]')), true);
    assert.equal(puts.length, 0, "browsing saves nothing");
  } finally { await view.close(); }
});

test("S1/S2 select is save: group disabled with a spinner while saving, then the check and root summary move; no toast", { timeout: 30000 }, async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  reset();
  const view = await mount();
  let release!: () => void;
  try {
    await view.openProfile();
    putGate = new Promise((resolve) => { release = resolve; });
    await view.choose("思考");
    assert.equal(puts.length, 1, "one PUT, no separate save button");
    assert.equal(JSON.stringify(puts[0]), JSON.stringify({ model: "gpt-6-astra", profileId: "thinking", effort: "" }));
    assert.equal(view.items("profile").every((item) => item.disabled), true, "S1: whole group disabled while saving");
    assert.equal(view.visible(view.q('[data-testid="mc-profile-saving"]')), true, "S1: spinner");
    assert.equal(view.checked("profile"), "思考", "the check moves to the pending choice");
    await React.act(async () => release());
    await settle();
    assert.equal(view.q('[data-testid="mc-profile-saving"]'), null);
    assert.equal(view.checked("profile"), "思考", "S2: stays on the saved item");
    assert.equal(view.items("profile")[1]!.disabled, false, "group enabled again");
    assert.equal(view.page("profile")!.querySelector("[role=alert]"), null, "S2: no message");
    assert.match(view.q('[data-testid="mc-profile-detail"]')!.textContent!, /chatReact\.effort.*chatReact\.effortHigh/, "D4A: read-only line under the selected preset");
    assert.match(view.controls().textContent!, /思考/, "summary 「预设 · 名称」 on the trigger");
    await view.click(view.q('[data-testid="mc-profile-page"] [data-testid="mc-ctl-back"]'));
    assert.match(view.q('[data-testid="mc-ctl-profile"]')!.textContent!, /思考/);
  } finally { await React.act(async () => release?.()); await view.close(); }
});

test("S3 save failure rolls back to the original choice, says so, never retries, and reopens send only after readback", { timeout: 30000 }, async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  reset();
  saved.set(DEFAULT, { profileId: "thinking", effort: "" });
  const view = await mount();
  try {
    await view.openProfile();
    assert.equal(view.checked("profile"), "思考");
    putFailure = Object.assign(new Error("Request failed with status code 500"), { status: 500 });
    await view.choose("快速");
    assert.equal(puts.length, 1);
    assert.equal(view.checked("profile"), "思考", "S3: check back on the original item");
    const alert = view.page("profile")!.querySelector("[role=alert]");
    assert.equal(alert?.textContent ?? "", "chatReact.profileRolledBack", "未保存，已恢复原选择");
    assert.equal(view.items("profile")[1]!.disabled, false, "readback confirmed: choosable again");
    putFailure = null;
    await view.send("hi");
    assert.equal(view.created.length, 1, "send gate reopened after the readback");
    assert.equal(String(view.created[0]!.profileId), "thinking", "the original (persisted) preset is the one sent");
    assert.equal(puts.length, 1, "the failed write was not replayed");
  } finally { await view.close(); }
});

test("S4 cancel: Escape, a press outside and the narrow scrim close without changing; reopening starts at the root", { timeout: 30000 }, async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  reset();
  const view = await mount();
  try {
    await view.openProfile();
    await view.key("Escape");
    assert.equal(view.menu().hidden, true);
    await view.open();
    assert.equal(view.visible(view.q('[data-testid="mc-ctl-profile"]')), true, "reopens on the root list");
    await view.click(view.q('[data-testid="mc-ctl-profile"]'));
    await React.act(async () => document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true })));
    await settle();
    assert.equal(view.menu().hidden, true);
    await view.openProfile();
    await view.click(view.q(".mc-controls .mc-scrim"));
    assert.equal(view.menu().hidden, true, "tapping the drawer scrim closes");
    assert.equal(puts.length, 0, "S4: nothing saved");
    assert.equal(saved.size, 0);
  } finally { await view.close(); }
});

test("S5 + D7A: levels outside the preset whitelist are greyed with 「当前预设不支持」; effort keeps priority and writes the stored preset back", { timeout: 30000 }, async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  reset();
  saved.set(DEFAULT, { profileId: "quick", effort: "low" });
  const view = await mount();
  try {
    await view.openEffort();
    const effort = view.items("effort").map((item) => `${item.querySelector(".mc-menu-text")!.textContent}${item.disabled ? "-" : "+"}`).join("|");
    assert.equal(effort, "chatReact.effortDefault+|chatReact.effortLow+|chatReact.effortMedium（chatReact.profileEffortOff）-|chatReact.effortHigh（chatReact.profileEffortOff）-");
    await view.click(view.items("effort")[0]!);
    assert.equal(JSON.stringify(puts.at(-1)), JSON.stringify({ model: "gpt-6-astra", profileId: "quick", effort: "" }), "effort change writes the stored preset back");
    await view.send("hi");
    assert.equal(String(view.created[0]!.profileId), "quick", "the preset rides on the turn");
    assert.equal("reasoningEffort" in view.created[0]!, false, "never both fields");
  } finally { await view.close(); }
  saved.set(DEFAULT, { profileId: "quick", effort: "high" });
  const other = await mount();
  try {
    await other.openProfile();
    assert.match(other.page("profile")!.textContent!, /chatReact\.profileEffortNote/, "remembered level outside the preset: 发送时按默认");
  } finally { await other.close(); }
});

test("S6 / D6A: a model without presets shows no 预设 row at all", { timeout: 30000 }, async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  reset();
  profilesFor = () => [];
  const view = await mount();
  try {
    await view.open();
    assert.equal(view.q('[data-testid="mc-ctl-profile"]'), null);
    assert.equal(view.visible(view.q('[data-testid="mc-ctl-effort"]')), true, "the effort row stays");
    assert.doesNotMatch(view.menu().textContent!, /chatReact\.profile/);
  } finally { await view.close(); }
});

test("S7 load failure: the page says 预设加载失败 with 重试, which loads the presets", { timeout: 30000 }, async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  reset();
  profileFailures = 99; // every /model-profiles read fails until the user retries
  const view = await mount();
  try {
    await view.openProfile();
    const page = view.page("profile")!;
    assert.equal(page.querySelector("[role=alert]")?.textContent ?? "", "chatReact.profileError");
    assert.equal(view.items("profile").length, 0, "no choices from a failed load");
    const retry = view.q('[data-testid="mc-profile-retry"]');
    assert.equal(retry?.textContent ?? "", "chatReact.retry");
    profileFailures = 0;
    await view.click(retry);
    assert.equal(view.page("profile")!.querySelector("[role=alert]"), null);
    assert.equal(view.items("profile").length, 4, "presets after retry");
  } finally { await view.close(); }
});

test("S8 switching model refetches that model's presets and shows its own remembered choice", { timeout: 30000 }, async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  reset();
  saved.set(DEFAULT, { profileId: "thinking", effort: "" });
  saved.set(keyOf({ executionBackend: "codex", providerId: 7, model: "deepseek-v4-flash" }), { profileId: "quick", effort: "" });
  profilesFor = (model) => model === "deepseek-v4-flash" ? PROFILES.slice(0, 1) : PROFILES;
  const view = await mount();
  try {
    await view.openProfile();
    assert.equal(view.checked("profile"), "思考");
    await view.key("Escape");
    profileReads = [];
    await view.click(view.q('[data-testid="mc-model"]'));
    await view.click(view.all('[data-testid="mc-model-menu"] [role=menuitemradio]').find((item) => item.textContent!.includes("deepseek-v4-flash")) ?? null);
    assert.equal(profileReads.includes("deepseek-v4-flash"), true, "catalog re-read for the new model");
    await view.openProfile();
    assert.equal(view.items("profile").length, 2, "that model's own catalog");
    assert.equal(view.checked("profile"), "快速", "that model's own saved choice");
  } finally { await view.close(); }
});

test("MUYU-408 + refresh: on the plain default new page a preset is settable, saved, and still selected after a reload", { timeout: 30000 }, async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  reset();
  const view = await mount();
  try {
    // No explicit model pick: the default comes from /model-selection (408 01a1f150: 预设都不能设置 on this page).
    await view.openProfile();
    assert.equal(view.items("profile")[1]!.disabled, false, "default page: presets are not greyed");
    await view.choose("快速");
    assert.equal(JSON.stringify(saved.get(DEFAULT)), JSON.stringify({ profileId: "quick", effort: "" }), "saved for the resolved default model");
    await view.remount();
    await view.openProfile();
    assert.equal(view.checked("profile"), "快速", "selection survives a reload (server readback)");
    await view.key("Escape");
    await view.send("hi");
    assert.equal(String(view.created[0]!.profileId), "quick", "the new conversation carries profileId");
  } finally { await view.close(); }
});

test("D4A: no temperature/top_p/max output editing anywhere in Controls", { timeout: 30000 }, async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  reset();
  const view = await mount();
  try {
    await view.openProfile();
    assert.equal(view.menu().querySelectorAll("input, select, textarea, [role=slider], [role=spinbutton]").length, 0);
    assert.doesNotMatch(view.menu().textContent!, /temperature|top_p|max_tokens|温度|最大输出/i);
  } finally { await view.close(); }
});

test("design copy (draft recommended wording) and the narrow bottom drawer", () => {
  const zh = readFileSync("src/chat-react/islandStringsZh.ts", "utf8");
  for (const [key, text] of [["profile", "预设"], ["profileDefault", "默认（不使用预设）"], ["profileNote", "自动保存；思考强度优先于预设"],
    ["profileRolledBack", "未保存，已恢复原选择"], ["profileError", "预设加载失败"], ["retry", "重试"], ["back", "返回"], ["profileEffortOff", "当前预设不支持"]]) {
    assert.match(zh, new RegExp(`\\b${key}: "${text}"`), `${key} = ${text}`);
  }
  const css = readFileSync("src/chat-react/chat.css", "utf8");
  const narrow = css.slice(css.indexOf("@media (max-width: 520px)"));
  assert.match(narrow, /\.mc-controls \.mc-menu \{[^}]*position: fixed;[^}]*bottom: 0;[^}]*max-height: 75vh;/, "full-width bottom drawer, ≤75% viewport");
  assert.match(narrow, /\.mc-controls \.mc-menu-item \{[^}]*min-height: 44px;/, "≥44px rows");
  assert.match(narrow, /\.mc-controls \.mc-scrim \{[^}]*display: block;/, "scrim only on narrow screens");
  assert.match(css, /\.mc-scrim \{[^}]*display: none;/);
  assert.match(readFileSync("src/chat-react/profileFeature.ts", "utf8"), /export const PROFILE_UI_ENABLED\s*=\s*true;/, "D8A: code switch on");
});
