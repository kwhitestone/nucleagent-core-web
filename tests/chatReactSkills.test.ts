// MUYU-365 V6: the chat composer picks skills. A picked skill lets the model use it and the tools it brings
// this turn (request field skillIds); its ready tools show locked in the 工具 panel until every picking skill
// is removed. Tools stay a separate, equal + menu entry (option B). Plain user wording only.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";
import { ZH_STRINGS } from "../src/chat-react/islandStringsZh.ts";

let vite: ViteDevServer;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let app: typeof import("../src/chat-react/ChatApp.tsx");
let reads: string[] = [];
let writes: { method: string; url: string; body: unknown }[] = [];
let failSkills = false;
let putError: Error | null = null;
let disposeRuntime: () => void;
let disposeCatalog: () => void;
const MAIN: Record<string, string> = { "agents.mine.errToolCovered": "该工具已随所选技能提供，请取消其一", "common.toolCoveredBySkill": "已随所选技能提供" };
const t = (key: string) => MAIN[key] ?? key;

const skills = [
  { id: 1, name: "图像创作", toolCount: 2, linkedTools: [{id:10,name:"图生图",ready:true},{id:11,name:"文生图",ready:true}], hiddenTools:1, config: { description: "画图" } },
  { id: 2, name: "智能扩图", toolCount: 1 },
  { id: 3, name: "写作助手", toolCount: 0, config: { description: "语音合成协议" } },
];
const tools = [
  { id: 10, name: "图生图", status: "ready", skillIds: [1, 2] },
  { id: 11, name: "文生图", status: "ready", skillIds: [1] },
  { id: 12, name: "组图生成", status: "unavailable", reason: "held", skillIds: [1] },
  { id: 13, name: "飞书读取文档", status: "ready", skillIds: [] },
  { id: 14, name: "停用的", status: "disabled", reason: "manual_disabled", skillIds: [] },
  { id: 16, name: "search_users · GitHub", status: "ready", skillIds: [] },
  { id: 15, name: "同步冲突的", status: "unavailable", reason: "conflict", skillIds: [] },
];
let bindings = { skillIds: [] as number[], toolIds: [] as number[], editable: true, revision: "1", principal: "11" };
const page = (rows: unknown[], url: string) => {
  const q = new URL(url, "https://x").searchParams;
  const search = q.get("search") ?? "";
  const ids = q.get("ids")?.split(",").map(Number);
  const data = (rows as { id: number; name: string }[]).filter((row) => row.name.includes(search) && (!ids || ids.includes(row.id)));
  return { data, hasMore: false, sortVersion: "v1" };
};
const response = (url: string) => /\/addons\/skill(\?|$)/.test(url) ? (() => { if (failSkills) throw new Error("down"); return page(skills, url); })()
  : /\/tool\/catalog(\?|$)/.test(url) ? page(tools, url)
  : { data: url.endsWith("execution-backends") ? [{ id: "codex", default: true }]
    : url.endsWith("/bindings") ? bindings
    : url.endsWith("model-selection") ? { executionBackend: "codex", providerId: 1, model: "chat-model", resolved: true }
    : url.endsWith("model-preferences") ? { profileId: "", effort: "" }
    : url.endsWith("model-profiles") ? []
    : /\/api\/v1\/files\?/.test(url) ? { owner: "user:11", items: [], hasMore: false }
    : { id: "7", providerId: 1, model: "chat-model", executionBackend: "codex", status: "completed" } };

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
    get: async (url: string) => { reads.push(url); return { data: response(url) }; },
    put: async (url: string, body: { skillIds?: number[]; toolIds?: number[] }) => {
      writes.push({ method: "PUT", url, body });
      if (putError) throw putError;
      bindings = { ...bindings, skillIds: body.skillIds ?? bindings.skillIds, toolIds: body.toolIds ?? bindings.toolIds, revision: String(Number(bindings.revision) + 1) };
      return { data: { data: bindings } };
    },
    post: async (url: string, body: unknown) => {
      writes.push({ method: "POST", url, body });
      if (url.endsWith("/bindings/sync")) return { data: { data: bindings } };
      if (url.endsWith("/generations")) return { data: { id: 1, conversationId: 55 } };
      throw new Error("unexpected write");
    },
    patch: async () => { throw new Error("unexpected write"); },
  } });
  const { registerModelCatalog } = await vite.ssrLoadModule("/src/contracts/model-catalog.ts");
  disposeCatalog = registerModelCatalog({
    listProviders: async () => [{ id: 1, name: "provider", isActive: true, config: { models: ["chat-model"] } }],
    listTypedModels: async (type: string) => ["chat", "image", "video"].includes(type) ? [{ providerId: 1, model: `${type}-model`, type, capabilities: [] }] : [],
    fetchVisibleModels: async () => [],
  });
});
after(async () => { disposeCatalog?.(); disposeRuntime?.(); await vite?.close(); });

const settle = async () => { for (let turn = 0; turn < 6; turn++) await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
async function mount(conversationId?: string) {
  reads = []; writes = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const created: Record<string, unknown>[] = [];
  await React.act(async () => root.render(React.createElement(app.ChatApp, { t, strings: ZH_STRINGS as never, conversationId,
    navigate: () => {}, create: async (payload: Record<string, unknown>) => { created.push(payload); return { id: "55" } as never; } } as never)));
  await settle();
  const q = <E extends Element = HTMLElement>(selector: string) => container.querySelector<E & HTMLElement>(selector);
  const click = async (button: HTMLElement | null | undefined) => { assert.ok(button); await React.act(async () => button.click()); await settle(); };
  const open = async (label: string) => {
    await click(q<HTMLButtonElement>(`[aria-label="${ZH_STRINGS.addTools}"]`));
    await click([...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent?.trim() === label));
  };
  const row = (name: string) => [...container.querySelectorAll<HTMLButtonElement>(".mc-tools-panel [aria-pressed]")].find((b) => b.querySelector(".mc-row-name")?.textContent === name);
  return {
    container, created, q, click, row,
    openSkills: () => open(ZH_STRINGS.skills),
    openTools: () => open(ZH_STRINGS.toolGrant),
    skillChips: () => [...container.querySelectorAll<HTMLElement>('[data-testid="mc-skill-picks"] .mc-chip-name')].map((chip) => chip.textContent),
    send: async (text: string) => {
      const input = q<HTMLTextAreaElement>("textarea")!;
      await React.act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
        input.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
      await click(q<HTMLButtonElement>('[data-testid="mc-send"]'));
    },
    close: async () => { await React.act(async () => root.unmount()); container.remove(); },
  };
}
const mock = (context: { mock: { method: (...args: never[]) => unknown } }) =>
  (context.mock.method as (o: object, m: string, f: () => unknown) => unknown)(globalThis, "fetch", async () => new Response("", { status: 404 }));

test("skills and tools are two equal + menu entries; each skill row says how many tools it brings", async (context) => {
  mock(context);
  const view = await mount();
  try {
    await view.openSkills();
    const panel = view.q(".mc-tools-panel")!;
    assert.equal(panel.hidden, false);
    assert.equal(view.q(".mc-tools-heading strong")!.textContent, "技能");
    assert.match(view.row("图像创作")!.textContent!, /带 2 个工具/);
    assert.match(view.row("图像创作")!.textContent!, /画图/, "description line");
    assert.match(view.row("智能扩图")!.textContent!, /带 1 个工具/);
    assert.match(view.row("写作助手")!.textContent!, /不带工具/);
    // The panel sits outside the input area: the input and the picked chips stay in view while picking.
    const composerRoot = view.q("textarea")!.closest("form, .aui-composer-root, [class*=composer]")!;
    assert.equal(panel.contains(view.q("textarea")), false);
    await view.click(view.row("图像创作"));
    assert.deepEqual(view.skillChips(), ["图像创作"]);
    assert.equal(panel.contains(view.q('[data-testid="mc-skill-picks"]')), false, "picked chips are not under the panel");
    assert.ok(composerRoot.contains(view.q('[data-testid="mc-skill-picks"]')));
    const detail = view.q<HTMLDetailsElement>('[data-testid="mc-skill-picks"] details')!;
    assert.ok(detail);
    await view.click(detail.querySelector("summary"));
    assert.match(detail.textContent!, /图生图/);
    assert.match(detail.textContent!, /另有 1 个暂不可用/);
    assert.equal(detail.querySelector("input,select,textarea"),null);
    assert.equal(panel.hidden, false, "the panel stays open for more picks");
  } finally { await view.close(); }
});

test("a picked skill locks the tools it brings; a shared tool unlocks only when every skill bringing it is removed", async (context) => {
  mock(context);
  const view = await mount();
  try {
    await view.openSkills();
    await view.click(view.row("图像创作"));
    await view.click(view.row("智能扩图"));
    await view.openTools();
    assert.equal(view.q(".mc-tools-heading strong")!.textContent, "工具");
    const shared = view.row("图生图")!;
    assert.equal(shared.getAttribute("aria-pressed"), "true");
    assert.equal(shared.disabled, true);
    assert.match(shared.textContent!, /已随所选技能提供/);
    assert.match(shared.textContent!, /由 2 个技能提供/);
    assert.equal(view.row("文生图")!.disabled, true);
    assert.equal(view.row("组图生成"), undefined, "held is hidden");
    assert.equal(view.row("停用的"), undefined, "manually disabled is hidden");
    assert.equal(view.row("同步冲突的")!.disabled, true, "other states stay listed, not pickable");
    assert.equal(view.row("飞书读取文档")!.disabled, false, "a tool no skill brings is pickable");

    const chip = (name: string) => [...view.container.querySelectorAll('[data-testid="mc-skill-picks"] .mc-chip')].find((c) => c.querySelector(".mc-chip-name")?.textContent === name);
    await view.click(chip("图像创作")!.querySelector<HTMLElement>("button"));
    assert.equal(view.row("图生图")!.disabled, true, "still brought by 智能扩图");
    assert.equal(view.row("文生图")!.disabled, false, "only 图像创作 brought it");
    await view.click(chip("智能扩图")!.querySelector<HTMLElement>("button"));
    assert.equal(view.row("图生图")!.disabled, false);
    assert.equal(view.row("图生图")!.getAttribute("aria-pressed"), "false");
  } finally { await view.close(); }
});

test("a new chat sends skillIds and drops a hand-picked tool a picked skill already brings", async (context) => {
  mock(context);
  const view = await mount();
  try {
    await view.openTools();
    await view.click(view.row("图生图"));
    await view.click(view.row("飞书读取文档"));
    await view.openSkills();
    await view.click(view.row("智能扩图"));
    await view.send("把这张图扩一下");
    assert.equal(view.created.length, 1);
    assert.deepEqual(view.created[0].skillIds, [2]);
    assert.deepEqual(view.created[0].toolIds, [13], "图生图 comes with the skill");
  } finally { await view.close(); }
});

test("making an image is a different mode: skill chips step aside, the job carries no skillIds, leaving restores them", async (context) => {
  mock(context);
  const view = await mount();
  try {
    await view.openSkills();
    await view.click(view.row("写作助手"));
    assert.match(view.q('[data-testid="mc-skill-picks"]')!.textContent!, /允许模型按需使用/);
    await view.click(view.q<HTMLButtonElement>('[data-testid="mc-gen-image"]'));
    assert.ok(view.q('[data-testid="mc-media-mode"]'));
    assert.equal(view.q('[data-testid="mc-skill-picks"]'), null, "skills do not apply while making an image");
    await view.send("画一只猫");
    const job = writes.find((w) => w.url.endsWith("/generations"));
    assert.ok(job, "image mode sends a generation job");
    assert.equal("skillIds" in (job.body as object), false);
    assert.deepEqual(view.created, [], "no chat turn");
    await view.click(view.q<HTMLButtonElement>(`[aria-label="${ZH_STRINGS.exitMode}"]`));
    assert.deepEqual(view.skillChips(), ["写作助手"], "back in chat the pick is unchanged");
  } finally { await view.close(); }
});

test("an existing conversation saves skills with its tools; the conflict answer shows the product wording", async (context) => {
  mock(context);
  bindings = { skillIds: [2], toolIds: [13], editable: true, revision: "1", principal: "11" };
  const view = await mount("7");
  try {
    assert.deepEqual(view.skillChips(), ["智能扩图"], "bound skills read back after a refresh");
    assert.ok(reads.some((url) => /\/addons\/skill\?.*ids=2/.test(url)));
    await view.openSkills();
    assert.equal(view.row("智能扩图")!.getAttribute("aria-pressed"), "true");
    await view.click(view.row("图像创作"));
    const puts = writes.filter((w) => w.method === "PUT");
    assert.deepEqual(puts[0].body, { skillIds: [2, 1], revision: "1" }, "a skill-only edit preserves even previously bound tools that are no longer selectable");
    putError = Object.assign(new Error("tool_covered_by_skill"), { status: 422 });
    await view.click(view.row("写作助手"));
    assert.ok(document.body.textContent!.includes("该工具已随所选技能提供，请取消其一"));
    assert.deepEqual(view.skillChips(), ["智能扩图", "图像创作"], "a refused save keeps the saved set");
  } finally { putError = null; await view.close(); bindings = { skillIds: [], toolIds: [], editable: true, revision: "1", principal: "11" }; }
});

test("load failure offers a retry in plain words; the end of the list says so", async (context) => {
  mock(context);
  failSkills = true;
  const view = await mount();
  try {
    await view.openSkills();
    const retry = [...view.container.querySelectorAll<HTMLButtonElement>(".mc-tools-panel button")].find((b) => b.textContent === "加载失败，点此重试");
    assert.ok(retry);
    failSkills = false;
    await view.click(retry);
    assert.ok(view.row("图像创作"));
    assert.ok(view.q(".mc-tools-panel")!.textContent!.includes("暂时没有更多了"));
  } finally { failSkills = false; await view.close(); }
});

test("no technical words in the new skill and tool UI (text, aria-label, title, placeholder)", async (context) => {
  mock(context);
  const view = await mount();
  try {
    const banned = /held|manual_disabled|冻结|后端|合成|读回|sortVersion|置顶|权重|协议|responses|executor|执行器|tool_covered_by_skill|[a-z]+_[a-z_]+/;
    const scan = (root: Element) => [root.textContent ?? "", ...[...root.querySelectorAll("*")].flatMap((e) => ["aria-label", "title", "placeholder"].map((a) => e.getAttribute(a) ?? ""))].join("\n");
    await view.openSkills();
    await view.click(view.row("图像创作"));
    assert.doesNotMatch(scan(view.q(".mc-tools-panel")!), banned);
    await view.openTools();
    assert.doesNotMatch(scan(view.q(".mc-tools-panel")!), banned);
    assert.doesNotMatch(scan(view.q('[data-testid="mc-skill-picks"]')!), banned);
  } finally { await view.close(); }
});
