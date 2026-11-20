import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";
import { ZH_STRINGS } from "../src/chat-react/islandStringsZh.ts";
import { EN_STRINGS } from "../src/chat-react/islandStringsEn.ts";
import { engineInput } from "./fixtures/workflowTyped.ts";

let vite: ViteDevServer;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let MediaCard: typeof import("../src/chat-react/MediaCard.tsx").MediaCard;
let WorkflowForm: typeof import("../src/chat-react/WorkflowForm.tsx").WorkflowForm;
let useSettings: typeof import("../src/chat-react/ChatApp.tsx").useSettings;
let settings: ReturnType<typeof useSettings>;
let response: (url: string) => unknown;
let writes: string[];
let reads: string[];
let downloads: string[];
let posted: unknown[] | null = null;
let typed: Record<string, unknown[]> | null = null;
let app: typeof import("../src/chat-react/ChatApp.tsx");
let disposeRuntime: () => void;
let disposeCatalog: () => void;
const t = (key: string) => key;
const mediaData = (taskId: number, kind = "image") => ({ media: { taskId, kind }, prompt: "历史提示", failed: false });
const task = (id: number, status: string, downloadUrl?: string) => ({ id, status, kind: "image", downloadUrl });

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
  ({ MediaCard } = await vite.ssrLoadModule("/src/chat-react/MediaCard.tsx"));
  ({ WorkflowForm } = await vite.ssrLoadModule("/src/chat-react/WorkflowForm.tsx"));
  app = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx") as typeof app;
  ({ useSettings } = app);
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  disposeRuntime = registerPlatformRuntime({ getAccessToken: () => "fixture", getSessionVersion: () => 1, http: {
    get: async (url: string) => { reads.push(url); return { data: await response(url) }; },
    patch: async (url: string, body: unknown) => { writes.push(url); return { data: { data: body } }; },
    post: async (url: string, body: unknown) => { writes.push(url); if (!posted) throw new Error("unexpected write"); posted.push(body); return { data: { data: { id: "7" } } }; },
  } });
  const { registerModelCatalog } = await vite.ssrLoadModule("/src/contracts/model-catalog.ts");
  disposeCatalog = registerModelCatalog({
    listProviders: async () => [{ id: 1, name: "provider", isActive: true, config: { models: ["chat-model"] } }],
    listTypedModels: async (type: string) => typed?.[type] ?? (["chat", "image", "video"].includes(type) ? [{ providerId: 1, model: `${type}-model`, type, capabilities: [] }] : []),
    fetchVisibleModels: async () => [],
  });
  dom.window.HTMLAnchorElement.prototype.click = function () { downloads.push(this.href); };
});
after(async () => { disposeCatalog?.(); disposeRuntime?.(); await vite?.close(); });

test("generation tools picker exposes the localized visible and accessible name without submitting", async () => {
  for (const strings of [ZH_STRINGS, EN_STRINGS]) {
    const view = await fixture();
    response = () => ({ data: [] });
    let submissions = 0;
    const translate = (key: string) => strings[key.replace("chatReact.", "") as keyof typeof strings] ?? key;
    try {
      await view.render(React.createElement(WorkflowForm, { t: translate, submit: async () => { submissions++; } }));
      assert.equal(view.container.querySelector("summary")!.textContent, strings.workflow);
      await React.act(async () => {
        const details = view.container.querySelector("details")!;
        details.open = true;
        details.dispatchEvent(new window.Event("toggle"));
      });
      assert.equal(view.container.querySelector("select")!.getAttribute("aria-label"), strings.workflow);
      assert.doesNotMatch(view.container.textContent!, /生成工作流|Generation workflow/);
      assert.equal(submissions, 0);
      assert.deepEqual(writes, []);
    } finally { await view.close(); }
  }
});

// MUYU-365 exp85: the user-filled form remains only for native audio (the text/file is the user's material).
test("native audio form uses its schema and holds an unknown submission without replay", async () => {
  const view = await fixture();
  response = (url) => ({ data: url.includes("/catalog") ? [{ id: 37, name: "语音合成", imported: false, status: "ready", nativeCapability: "nucleagent.audio.tts.v1", nativeModel: "qwen3-tts-flash" }] : {
    nativeCapability: "nucleagent.audio.tts.v1", model: "qwen3-tts-flash", output: "audio/wav",
    invocation: { toolId: 37, revision: "7" }, inputSchema: { type: "object", additionalProperties: false, required: ["input", "voice"], properties: { input: { type: "string", maxLength: 256 }, voice: { type: "string", maxLength: 64 } } },
  } });
  const submitted: unknown[] = [];
  try {
    await view.render(React.createElement(WorkflowForm, { t, submit: async (request) => { submitted.push(request); throw new Error("connection lost"); } }));
    await React.act(async () => { const details = view.container.querySelector("details")!; details.open = true; details.dispatchEvent(new window.Event("toggle")); });
    const select = view.container.querySelector("select")!;
    await React.act(async () => { select.value = "37"; select.dispatchEvent(new window.Event("change", { bubbles: true })); });
    assert.doesNotMatch(view.container.textContent!, /workflowHint|workflowExecutionModel/);
    for (const [index, value] of [[0, "你好"], [1, "Cherry"]] as const) {
      const input = view.container.querySelectorAll("input")[index]!;
      await React.act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new window.Event("input", { bubbles: true })); });
    }
    await React.act(async () => view.container.querySelector("form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    assert.deepEqual(submitted, [{ toolId: 37, revision: "7", arguments: { input: "你好", voice: "Cherry" } }]);
    assert.equal(view.container.querySelector<HTMLButtonElement>("button[type=submit]")!.disabled, true);
    assert.match(view.container.textContent!, /workflowUnknown/);
    await React.act(async () => view.container.querySelector("form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(submitted.length, 1);
    assert.deepEqual(writes, []);
  } finally { await view.close(); }
});

async function fixture() {
  reads = []; writes = []; downloads = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return {
    container,
    render: async (element: import("react").ReactNode) => { await React.act(async () => root.render(element)); },
    click: async (text: string) => {
      const button = [...container.querySelectorAll("button")].find((entry) => entry.textContent === text);
      assert.ok(button, text);
      await React.act(async () => button.click());
    },
    close: async () => { await React.act(async () => root.unmount()); container.remove(); },
  };
}

test("composer tools keep draft and audio parameters across menu, keyboard and close; session change clears the form", async () => {
  const view = await fixture();
  const aui = await import("@assistant-ui/react");
  const { externalStore } = await vite.ssrLoadModule("/src/chat-react/externalStore.ts");
  const { createConversationState } = await vite.ssrLoadModule("/src/addons/conversation/task-conversation/core/reducer.ts");
  const { SESSION_CHANGE_EVENT } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  const Viewport = (await vite.ssrLoadModule("/src/chat-react/auiPrimitives.ts")).ThreadPrimitive.Viewport;
  response = url => ({ data: url.includes("/catalog") ? [{ id: 37, name: "语音合成", imported: false, status: "ready", nativeCapability: "nucleagent.audio.tts.v1", nativeModel: "qwen3-tts-flash" }] : {
    nativeCapability: "nucleagent.audio.tts.v1", model: "qwen3-tts-flash", output: "audio/wav",
    invocation: { toolId: 37, revision: "7" }, inputSchema: { type: "object", additionalProperties: false, required: ["input", "voice"], properties: { input: { type: "string", maxLength: 256 }, voice: { type: "string", maxLength: 64 } } },
  } });
  const submitted: unknown[] = [];
  function Harness({ existing = false }: { existing?: boolean }) {
    const runtime = aui.useExternalStoreRuntime(externalStore(createConversationState("7"), { send: async () => {}, stop: async () => {} }));
    return React.createElement(aui.AssistantRuntimeProvider, { runtime }, React.createElement(Viewport, null,
      React.createElement(app.Composer, { t, placeholder: "p", settings: { groups: [], model: null, backend: null, busy: false, pick: async () => {} } as never,
        grants: !existing && { tools: [], ids: [], enabled: [], editable: true, loaded: true, load: () => {}, toggle: () => {} },
        workflow: !existing && React.createElement(WorkflowForm, { t, submit: async request => { submitted.push(request); } }),
      })));
  }
  const more = () => view.container.querySelector<HTMLButtonElement>('[aria-label="chatReact.addTools"]')!;
  const inputs = () => view.container.querySelectorAll<HTMLInputElement>(".mc-workflow input");
  const fill = async (index: number, value: string) => {
    const input = inputs()[index]!;
    await React.act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new window.Event("input", { bubbles: true })); });
  };
  try {
    await view.render(React.createElement(Harness));
    await type(view, "草稿保持");
    assert.equal(view.container.querySelector(".mc-workflow"), null);
    await React.act(async () => more().dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    assert.equal(document.activeElement?.getAttribute("data-testid"), "mc-attach");
    await React.act(async () => document.activeElement!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "End", bubbles: true })));
    assert.equal(document.activeElement?.textContent, "chatReact.toolGrant");
    await React.act(async () => (document.activeElement as HTMLButtonElement).click());
    assert.ok(view.container.querySelector(".mc-composer .mc-workflow"));
    assert.equal(view.container.querySelector("form form"), null);
    const details = view.container.querySelector<HTMLDetailsElement>(".mc-workflow")!;
    assert.equal(details.open, false, "the audio form stays folded until asked for");
    await React.act(async () => { details.open = true; details.dispatchEvent(new window.Event("toggle")); });
    const select = () => view.container.querySelector<HTMLSelectElement>(".mc-workflow select")!;
    await React.act(async () => { select().value = "37"; select().dispatchEvent(new window.Event("change", { bubbles: true })); });
    await fill(0, "你好"); await fill(1, "Cherry");
    await React.act(async () => inputs()[1]!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(document.activeElement, more());
    assert.ok(view.container.querySelector<HTMLDivElement>(".mc-tools-panel")!.hidden);
    await React.act(async () => more().click());
    await view.click("chatReact.toolGrant");
    assert.equal(inputs()[1]!.value, "Cherry");
    assert.equal(view.container.querySelector<HTMLTextAreaElement>("textarea")!.value, "草稿保持");
    await React.act(async () => view.container.querySelector(".mc-workflow form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    assert.deepEqual(submitted, [{ toolId: 37, revision: "7", arguments: { input: "你好", voice: "Cherry" } }]);
    await React.act(async () => window.dispatchEvent(new window.Event(SESSION_CHANGE_EVENT)));
    assert.equal(view.container.querySelector(".mc-workflow"), null);
    await React.act(async () => more().click());
    await view.click("chatReact.toolGrant");
    assert.equal(view.container.querySelector<HTMLDetailsElement>(".mc-workflow")!.open, false);
    await view.render(React.createElement(Harness, { existing: true }));
    assert.equal(view.container.querySelector(".mc-tools-panel"), null);
    assert.equal(view.container.querySelector('[data-testid="mc-attach"]')?.getAttribute("role"), "menuitem");
    assert.deepEqual(writes, []);
  } finally { await view.close(); }
});

test("audio selector finds later-page native tools without admitting held or generic (grant-only) tools", async () => {
  const view = await fixture();
  response = (url) => {
    const page = new URL(url, "https://test.example").searchParams.get("page") ?? "1";
    return page === "1" ? { hasMore: true, data: [{ id: 1, name: "first", imported: false, status: "ready", nativeCapability: "nucleagent.audio.tts.v1", nativeModel: "qwen3-tts-flash" }] }
      : { hasMore: false, data: [
        { id: 290, name: "stt", imported: false, status: "ready", nativeCapability: "nucleagent.audio.stt.v1", nativeModel: "whisper-1" },
        { id: 291, name: "held", imported: false, status: "held", nativeCapability: "nucleagent.audio.stt.v1", nativeModel: "whisper-1" },
        { id: 294, name: "generic", imported: true, status: "ready" },
      ] };
  };
  try {
    await view.render(React.createElement(WorkflowForm, { t, submit: async () => { throw new Error("unexpected submission"); } }));
    await React.act(async () => { const details = view.container.querySelector("details")!; details.open = true; details.dispatchEvent(new window.Event("toggle")); });
    assert.deepEqual([...view.container.querySelectorAll("option")].map(option => option.value), ["0", "1", "290"]);
    assert.equal(reads.length, 2);
    assert.deepEqual(writes, []);
  } finally { await view.close(); }
});

test("history remount fetches fresh token; download validates current task state and never writes", async () => {
  const view = await fixture();
  let current = task(7, "succeeded", "https://cdn.example/media?token=first");
  response = () => current;
  try {
    await view.render(React.createElement(MediaCard, { data: mediaData(7), t }));
    assert.match(view.container.querySelector("img")!.src, /token=first/);
    current = task(7, "succeeded", "https://cdn.example/media?token=fresh");
    await view.click("common.attachmentDownload");
    assert.deepEqual(downloads, [current.downloadUrl]);
    current = task(7, "failed", "https://cdn.example/media?token=must-not-open");
    await view.click("common.attachmentDownload");
    assert.equal(downloads.length, 1);
    assert.match(view.container.textContent!, /chatReact.mediaReadFailed/);
    assert.equal(view.container.querySelector("img"), null);
    await view.render(null);
    current = task(7, "succeeded", "https://cdn.example/media?token=remount");
    await view.render(React.createElement(MediaCard, { data: mediaData(7), t }));
    assert.match(view.container.querySelector("img")!.src, /token=remount/);
    assert.deepEqual(writes, []);
  } finally { await view.close(); }
});

test("history refresh handles unknown/cancelled, GET errors, unsafe URLs and expired image without spinning forever", async () => {
  const view = await fixture();
  let current = task(7, "running");
  response = () => current;
  try {
    await view.render(React.createElement(MediaCard, { data: mediaData(7), t }));
    assert.match(view.container.textContent!, /chatReact.media_running/);
    for (const status of ["unknown", "cancelled", "failed"]) {
      current = task(7, status);
      await view.click("chatReact.mediaRefresh");
      assert.match(view.container.textContent!, new RegExp(`generate.status.${status}`));
      assert.equal(view.container.querySelector("img"), null);
    }
    response = () => { throw new Error("private service detail"); };
    await view.click("chatReact.mediaRefresh");
    assert.match(view.container.textContent!, /chatReact.mediaReadFailed/);
    assert.doesNotMatch(view.container.textContent!, /private service detail/);
    response = () => task(7, "succeeded", "javascript:alert(1)");
    await view.click("chatReact.mediaRefresh");
    assert.equal(view.container.querySelector("img"), null);
    response = () => task(7, "succeeded", "https://cdn.example/expired");
    await view.click("chatReact.mediaRefresh");
    await React.act(async () => view.container.querySelector("img")!.dispatchEvent(new window.Event("error")));
    assert.match(view.container.textContent!, /chatReact.mediaReadFailed/);
    assert.deepEqual(writes, []);
  } finally { await view.close(); }
});

test("pending history polls are bounded and unmount cancels further reads", async (context) => {
  const view = await fixture();
  response = () => task(7, "queued");
  context.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    await view.render(React.createElement(MediaCard, { data: mediaData(7), t }));
    assert.match(view.container.textContent!, /chatReact.media_queued/);
    for (let tick = 0; tick < 25; tick++) await React.act(async () => context.mock.timers.tick(3000));
    assert.equal(reads.length, 20);
    await view.click("chatReact.mediaRefresh");
    assert.equal(reads.length, 21);
    await view.render(null);
    await React.act(async () => context.mock.timers.tick(3000));
    assert.equal(reads.length, 21);
    assert.deepEqual(writes, []);
  } finally { await view.close(); context.mock.timers.reset(); }
});

test("late task responses cannot overwrite a different history card; video is playable", async () => {
  const view = await fixture();
  let resolveOld!: (value: unknown) => void;
  response = (url) => url.endsWith("/7") ? new Promise((resolve) => { resolveOld = resolve; }) : { ...task(8, "succeeded", "https://cdn.example/video"), kind: "video" };
  try {
    await view.render(React.createElement(MediaCard, { data: mediaData(7), t }));
    await view.render(React.createElement(MediaCard, { data: mediaData(8, "video"), t }));
    await React.act(async () => resolveOld(task(7, "succeeded", "https://cdn.example/old")));
    assert.equal(view.container.querySelector("img"), null);
    assert.equal(view.container.querySelector("video")!.src, "https://cdn.example/video");
    assert.equal(view.container.querySelector("video")!.controls, true);
  } finally { await view.close(); }
});

const imageSchema = { model: "image-model", invocation: { toolId: 9, revision: "4" }, inputSchema: { type: "object", additionalProperties: false, required: ["input", "aspect_ratio"],
  properties: { input: { type: "string" }, aspect_ratio: { type: "string", enum: ["1:1", "16:9"] } } } };
const directResponse = (bound: number[]) => (url: string) => ({ data: url.endsWith("execution-backends") ? [{ id: "codex", default: true }]
  : /\/catalog(\?|$)/.test(url) ? [{ id: 9, name: "图片", imported: true, status: "ready", mediaModel: "image-model" }]
  : url.endsWith("/9/schema") ? imageSchema
  : url.endsWith("/bindings") ? { skillIds: [], toolIds: bound, editable: true, revision: "1", principal: "1" }
  : { id: "7", providerId: 1, model: "chat-model", executionBackend: "codex" } });
const sendKey = (view: { container: HTMLElement }) => view.container.querySelector<HTMLButtonElement>('[data-testid="mc-send"]')!;
async function type(view: { container: HTMLElement }, text: string) {
  const input = view.container.querySelector("textarea")!;
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}
const settle = async () => { for (let turn = 0; turn < 4; turn++) await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

test("direct model form shows actual video typed fields and refuses uncontrolled required images", async () => {
  const view = await fixture();
  const base = directResponse([]);
  response = url => /\/catalog(\?|$)/.test(url) ? { data: [{ id: 788, name: "即梦视频", imported: true, status: "ready", mediaModel: "video-model" }] }
    : url.endsWith('/788/schema') ? { data: { model: "video-model", invocation: { toolId: 788, revision: "5" }, inputSchema: {
      type: "object", additionalProperties: false, required: ["prompt", "image_url", "duration", "resolution"],
      properties: Object.fromEntries(["prompt", "image_url", "duration", "resolution", "seed", "aspect_ratio"].map(name => [name, engineInput.properties[name]])),
    } } } : base(url);
  const created: unknown[] = [];
  try {
    await view.render(React.createElement(app.ChatApp, { t, strings: {} as never, navigate: () => {}, create: async payload => { created.push(payload); return { id: "55" } as never; } }));
    await settle();
    await type(view, "video");
    await React.act(async () => view.container.querySelector<HTMLButtonElement>('[data-testid="mc-gen-video"]')!.click());
    await settle();
    const mode = view.container.querySelector('[data-testid="mc-media-mode"]')!;
    assert.ok(mode.querySelector('input[type="number"]'), JSON.stringify({ text: mode.textContent, reads }));
    assert.match(mode.textContent!, /duration.*5.*10/s);
    assert.match(mode.textContent!, /image_url \*.*chatReact.mediaUnavailable/s);
    assert.equal(mode.querySelector('input[type="text"]'), null);
    assert.equal(sendKey(view).disabled, true);
    await React.act(async () => sendKey(view).click());
    assert.deepEqual(created, []);
  } finally { await view.close(); }
});

test("direct media send key: enabled only with real text, a loaded job schema and its required choice; one click is one create with the chosen parameters", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  const view = await fixture();
  response = directResponse([]);
  const created: any[] = [];
  const navigated: string[] = [];
  try {
    await view.render(React.createElement(app.ChatApp, { t, strings: {} as never, navigate: (path: string) => { navigated.push(path); },
      create: async (payload: unknown) => { created.push(payload); return { id: "55" } as never; } }));
    await settle();
    assert.equal(sendKey(view).disabled, true, "empty input");
    await type(view, "画一只猫");
    assert.equal(sendKey(view).disabled, false, "chat mode with text");

    // No job tool for any video model (exp86c): the pill preselects nothing and chat mode stays as it was.
    await React.act(async () => view.container.querySelector<HTMLButtonElement>('[data-testid="mc-gen-video"]')!.click());
    await settle();
    assert.equal(view.container.querySelector('[data-testid="mc-media-mode"]'), null, "no unwired preselect");
    assert.equal(view.container.querySelector('[data-testid="mc-gen-video"]')!.getAttribute("aria-disabled"), "true");

    await React.act(async () => view.container.querySelector<HTMLButtonElement>('[data-testid="mc-gen-image"]')!.click());
    await settle();
    assert.doesNotMatch(view.container.textContent!, /chatReact.mediaUnavailable/);
    const select = view.container.querySelector<HTMLSelectElement>('[data-testid="mc-media-mode"] select')!;
    assert.equal(select.value, "1:1", "MUYU-365 exp98: a required choice starts at the schema's first value");
    assert.equal(sendKey(view).disabled, false, "nothing has to be picked to send");
    await React.act(async () => { select.value = "16:9"; select.dispatchEvent(new window.Event("change", { bubbles: true })); });
    assert.equal(sendKey(view).disabled, false, "text + schema + required choice");
    await type(view, "");
    assert.equal(sendKey(view).disabled, true, "empty input in media mode");
    await type(view, "画一只猫");
    assert.equal(sendKey(view).disabled, false);

    await React.act(async () => sendKey(view).click());
    await settle();
    assert.equal(created.length, 1);
    assert.deepEqual(created[0].toolIds, [9]);
    assert.deepEqual(created[0].toolInvocation, { toolId: 9, revision: "4", arguments: { aspect_ratio: "16:9", input: "画一只猫" } });
    assert.equal(created[0].input, "画一只猫");
    assert.notEqual(created[0].model, "image-model", "the media model is bound by Core from the tool, never sent as the chat model");
    assert.deepEqual(navigated, ["/c/55"]);
    assert.deepEqual(writes, []);
  } finally { await view.close(); }
});

test("a follow-up carries the bound invocation once; an active run closes the media send key and Enter", async () => {
  const { createConversationAdapter } = await vite.ssrLoadModule("/src/addons/conversation/composables/useConversationAdapter.ts");
  const toolInvocation = { toolId: 9, revision: "4", arguments: { aspect_ratio: "16:9", input: "再来一张" } };
  posted = [];
  try {
    await createConversationAdapter(() => "7").execute({ type: "send", content: "再来一张", clientMessageId: "c1", toolInvocation }, { signal: new AbortController().signal });
    assert.deepEqual(posted, [{ input: "再来一张", toolInvocation }]);
    assert.deepEqual(writes.filter((url) => url.endsWith("/7/follow-up")).length, 1);
  } finally { posted = null; }

  const aui = await import("@assistant-ui/react");
  const { externalStore } = await vite.ssrLoadModule("/src/chat-react/externalStore.ts");
  const { createConversationState } = await vite.ssrLoadModule("/src/addons/conversation/task-conversation/core/reducer.ts");
  const Viewport = (await vite.ssrLoadModule("/src/chat-react/auiPrimitives.ts")).ThreadPrimitive.Viewport;
  const sent: unknown[] = [];
  const slot = (await vite.ssrLoadModule("/src/chat-react/singleSlotQueue.ts")).createSingleSlot(async () => {}, () => true, () => {});
  function Running({ direct }: { direct: boolean }) {
    const runtime = aui.useExternalStoreRuntime(externalStore({ ...createConversationState("7"), status: "running" }, { send: async (...args: unknown[]) => { sent.push(args); }, stop: async () => {} }, undefined, undefined, slot));
    const media = { kind: "image" as const, model: { providerId: 1, model: "image-model" } };
    return React.createElement(aui.AssistantRuntimeProvider, { runtime }, React.createElement(Viewport, null, React.createElement(app.Composer, { t, placeholder: "p",
      settings: { groups: [], model: null, backend: null, busy: false, pick: async () => {}, ...(direct ? { media, direct: { toolId: 9, schema: imageSchema }, params: { aspect_ratio: "16:9" } } : {}) } as never })));
  }
  const view = await fixture();
  try {
    await view.render(React.createElement(Running, { direct: false }));
    await type(view, "排队");
    assert.equal(sendKey(view).disabled, false, "a chat follow-up may still queue during a run");
    await view.render(React.createElement(Running, { direct: true }));
    await type(view, "再来一张");
    assert.equal(sendKey(view).disabled, true, "running: a paid media submission is not queued");
    await React.act(async () => view.container.querySelector("textarea")!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    assert.deepEqual(sent, []);
  } finally { await view.close(); }
});

test("a new conversation resolves the selected media model to its job tool; an existing one needs the tool bound to it", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  const view = await fixture();
  response = (url) => ({ data: url.endsWith("execution-backends") ? [{ id: "codex", default: true }]
    : /\/catalog(\?|$)/.test(url) ? [{ id: 9, name: "图片", imported: true, status: "ready", mediaModel: "image-model" }]
    : url.endsWith("/9/schema") ? { model: "image-model", invocation: { toolId: 9, revision: "4" }, inputSchema: { type: "object", additionalProperties: false, properties: { input: { type: "string" }, aspect_ratio: { type: "string", enum: ["1:1"] } } } }
    : { id: "7", providerId: 1, model: "chat-model", executionBackend: "codex" } });
  function Harness({ id }: { id?: string }) {
    settings = useSettings(id, t);
    return null;
  }
  try {
    await view.render(React.createElement(Harness, {}));
    const image = () => settings.groups.find((group) => group.kind === "image")!.options[0].choice;
    await React.act(async () => settings.pick(image()));
    await React.act(async () => undefined);
    assert.equal(settings.direct?.toolId, 9);
    await React.act(async () => settings.setParam("aspect_ratio", "1:1"));
    assert.deepEqual(settings.params, { aspect_ratio: "1:1" });

    // Another model without a job tool (exp86c): greyed with the reason and refused, the wired selection stays.
    const video = settings.groups.find((group) => group.kind === "video")!.options[0];
    assert.equal(video.unavailable, "unwired");
    await React.act(async () => settings.pick(video.choice));
    await React.act(async () => undefined);
    assert.equal(settings.media?.kind, "image");
    assert.equal(settings.direct?.toolId, 9);
    // Existing conversation: closed until the job tool is one of its bound tools (Core checks the same set).
    for (const [id, bound, toolId] of [["7", [], undefined], ["8", [9], 9]] as const) {
      const base = response;
      response = (url) => url.endsWith("/bindings") ? { data: { skillIds: [], toolIds: bound, editable: true, revision: "1", principal: "1" } } : base(url);
      await view.render(React.createElement(Harness, { id }));
      await settle();
      await React.act(async () => settings.pick(image()));
      await settle();
      assert.equal(settings.direct?.toolId, toolId);
      response = base;
    }
    assert.deepEqual(writes, []);
  } finally { await view.close(); }
});

test("typed media selection stays local, switches kind, preserves chat model and resets across conversations", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  const view = await fixture();
  const media = (id: number, model: string) => ({ model, invocation: { toolId: id, revision: "1" }, inputSchema: { type: "object", additionalProperties: false, properties: { input: { type: "string" } } } });
  response = (url) => ({ data: url.endsWith("execution-backends") ? [{ id: "codex", default: true }]
    : /\/catalog(\?|$)/.test(url) ? [{ id: 9, name: "i", imported: true, status: "ready", mediaModel: "image-model" }, { id: 10, name: "v", imported: true, status: "ready", mediaModel: "video-model" }]
    : url.endsWith("/9/schema") ? media(9, "image-model") : url.endsWith("/10/schema") ? media(10, "video-model")
    : url.endsWith("/bindings") ? { skillIds: [], toolIds: [9, 10], editable: true, revision: "1", principal: "1" }
    : { id: "7", providerId: 1, model: "chat-model", executionBackend: "codex" } });
  function Harness({ id }: { id?: string }) {
    settings = useSettings(id, t);
    return null;
  }
  try {
    await view.render(React.createElement(Harness, { id: "7" }));
    await settle();
    const chat = settings.model;
    assert.deepEqual(chat, { providerId: 1, model: "chat-model" });
    for (const kind of ["image", "video"] as const) {
      const choice = settings.groups.find((group) => group.kind === kind)!.options[0].choice;
      await React.act(async () => settings.pick(choice));
      assert.equal(settings.media?.kind, kind);
      assert.deepEqual(settings.model, chat);
    }
    assert.deepEqual(writes, []);
    await React.act(async () => settings.pick({ kind: "chat", model: chat! }));
    assert.equal(settings.media, null);
    assert.deepEqual(writes, []);
    await React.act(async () => settings.pick(settings.groups.find((group) => group.kind === "video")!.options[0].choice));
    await React.act(async () => settings.pick({ kind: "image", model: { providerId: 1, model: "unlisted" } }));
    assert.equal(settings.media?.kind, "video");
    await React.act(async () => settings.pick(null));
    assert.equal(settings.media, null);
    assert.equal(writes.length, 1);
    const choice = settings.groups.find((group) => group.kind === "image")!.options[0].choice;
    await React.act(async () => settings.pick(choice));
    await view.render(React.createElement(Harness, { id: "8" }));
    assert.equal(settings.media, null);
  } finally { await view.close(); }
});

// MUYU-365 exp86c: the media pills preselect a model that can really send; unwired models are greyed with a reason.
const wiredResponse = (rows: unknown[]) => (url: string) => /\/catalog(\?|$)/.test(url) ? { data: rows }
  : url.endsWith("/807/schema") ? { data: { ...imageSchema, model: "doubao-seedream-5-0-260128", invocation: { toolId: 807, revision: "1" } } }
  : url.endsWith("/788/schema") ? { data: { model: "jimeng_v30_1080p", invocation: { toolId: 788, revision: "5" }, inputSchema: { type: "object", additionalProperties: false, required: ["prompt"], properties: { prompt: { type: "string" } } } } }
  : url.endsWith("/901/schema") ? { data: { model: "viduq3-pro", invocation: { toolId: 901, revision: "2" }, inputSchema: { type: "object", additionalProperties: false, required: ["image_url"], properties: { image_url: { type: "string" } } } } }
  : directResponse([])(url);
const mediaTyped = {
  image: ["doubao-seedream-4-0-250828", "doubao-seedream-5-0-260128"].map(model => ({ providerId: 1, model, type: "image", capabilities: [], available: true })),
  video: ["MiniMax-H3", "jimeng_v30_1080p", "viduq3-pro"].map(model => ({ providerId: 1, model, type: "video", capabilities: [], available: true })),
};

test("media pills preselect the first model with a ready job tool; unwired models are greyed with a reason and cannot be picked", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  typed = { chat: [{ providerId: 1, model: "chat-model", type: "chat", capabilities: [] }], ...mediaTyped };
  const view = await fixture();
  response = wiredResponse([
    { id: 807, name: "图片", imported: true, status: "ready", mediaModel: "doubao-seedream-5-0-260128" },
    { id: 788, name: "即梦视频", imported: true, status: "ready", mediaModel: "jimeng_v30_1080p" },
    { id: 901, name: "vidu", imported: true, status: "ready", mediaModel: "viduq3-pro" },
  ]);
  const created: unknown[] = [];
  try {
    await view.render(React.createElement(app.ChatApp, { t, strings: {} as never, navigate: () => {}, create: async payload => { created.push(payload); return { id: "55" } as never; } }));
    await settle();
    await type(view, "画一只猫");
    await React.act(async () => view.container.querySelector<HTMLButtonElement>('[data-testid="mc-gen-image"]')!.click());
    await settle();
    let mode = view.container.querySelector('[data-testid="mc-media-mode"]')!;
    assert.match(mode.textContent!, /doubao-seedream-5-0-260128/);
    assert.doesNotMatch(mode.textContent!, /mediaUnavailable/);
    await React.act(async () => view.container.querySelector<HTMLButtonElement>('[data-testid="mc-gen-video"]')!.click());
    await settle();
    mode = view.container.querySelector('[data-testid="mc-media-mode"]')!;
    assert.match(mode.textContent!, /jimeng_v30_1080p/);
    assert.equal(sendKey(view).disabled, false, "the preselected model sends");

    const group = (kind: string) => [...view.container.querySelectorAll<HTMLElement>(`[data-testid="mc-model-menu"] [data-kind="${kind}"] [role=menuitemradio]`)];
    const names = (kind: string) => group(kind).map(item => item.querySelector(".mc-menu-text")!.firstChild!.textContent);
    assert.deepEqual(names("image"), ["doubao-seedream-5-0-260128", "doubao-seedream-4-0-250828"], "sendable first, unwired after");
    assert.deepEqual(names("video"), ["jimeng_v30_1080p", "MiniMax-H3", "viduq3-pro"]);
    for (const [item, reason] of [[group("image")[1], "unwired"], [group("video")[1], "unwired"], [group("video")[2], "no_prompt"]] as const) {
      assert.equal(item.getAttribute("aria-disabled"), "true");
      assert.match(item.textContent!, new RegExp(`chatReact.unavailable_${reason}`));
      await React.act(async () => item.click());
    }
    for (const item of [group("image")[0], group("video")[0]]) assert.equal(item.getAttribute("aria-disabled"), null);
    assert.match(view.container.querySelector('[data-testid="mc-media-mode"]')!.textContent!, /jimeng_v30_1080p/, "an unwired pick is refused");
    assert.equal(view.container.querySelector("textarea")!.value, "画一只猫", "draft kept");
    assert.deepEqual(created, []);
    assert.deepEqual(writes, []);
  } finally { typed = null; await view.close(); }
});

test("with no sendable media model the pill preselects nothing, stays keyboard-reachable and says why", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  typed = { chat: [{ providerId: 1, model: "chat-model", type: "chat", capabilities: [] }], ...mediaTyped };
  const view = await fixture();
  response = wiredResponse([{ id: 901, name: "vidu", imported: true, status: "ready", mediaModel: "viduq3-pro" }]);
  try {
    await view.render(React.createElement(app.ChatApp, { t, strings: {} as never, navigate: () => {}, create: async () => { throw new Error("no create"); } }));
    await settle();
    await type(view, "草稿");
    for (const kind of ["image", "video"]) {
      const pill = view.container.querySelector<HTMLButtonElement>(`[data-testid="mc-gen-${kind}"]`)!;
      assert.equal(pill.disabled, false, "focusable");
      await React.act(async () => pill.click());
      await settle();
      assert.equal(pill.getAttribute("aria-disabled"), "true");
      assert.match(pill.getAttribute("aria-label")!, /chatReact.mediaNone/);
      assert.equal(view.container.querySelector('[data-testid="mc-media-mode"]'), null, "nothing preselected");
    }
    assert.equal(view.container.querySelector("textarea")!.value, "草稿");
    assert.deepEqual(writes, []);
  } finally { typed = null; await view.close(); }
});
