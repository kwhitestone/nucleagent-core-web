import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";

let vite: ViteDevServer;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let Fields: typeof import("../src/chat-react/DirectMediaFields.tsx").DirectMediaFields;
let directMediaRequest: typeof import("../src/chat-react/workflowParams.ts").directMediaRequest;
let dom: JSDOM, dispose: () => void;
let version = 1;
let items: unknown[];
let pending: Promise<unknown> | undefined;
const file = { fileId: "owned-image", origName: "本人图片.png", mimeType: "image/png", size: 1024, status: "active", createdBy: "user:11" };
const schema = { invocation: { toolId: 789, revision: "5" }, inputSchema: { type: "object", additionalProperties: false, required: ["prompt", "first_frame_url", "last_frame_url"], properties: {
  prompt: { type: "string", minLength: 1 }, first_frame_url: { type: "string", "x-owned-image": true }, last_frame_url: { type: "string", "x-owned-image": true },
} } };
before(async () => {
  dom = new JSDOM("", { url: "https://test.example/" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  React = await import("react"); ({ createRoot } = await import("react-dom/client"));
  ({ DirectMediaFields: Fields } = await vite.ssrLoadModule("/src/chat-react/DirectMediaFields.tsx"));
  ({ directMediaRequest } = await vite.ssrLoadModule("/src/chat-react/workflowParams.ts"));
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  dispose = registerPlatformRuntime({ getAccessToken: () => "fixture", getSessionVersion: () => version, handleUnauthorizedResponse: () => {}, http: {
    get: async (url: string) => {
      if (url.includes("/api/v1/files?")) return { data: await (pending ?? Promise.resolve({ code: 0, data: { owner: "user:11", items, hasMore: false } })) };
      return { data: url.endsWith("/schema") ? { data: schema } : { data: [{ id: 789, name: "首尾帧视频", imported: true, status: "ready" }], hasMore: false } };
    }, post: async () => { throw new Error("No network writes"); },
  } });
});
after(async () => { dispose?.(); await vite?.close(); dom?.window.close(); });
// MUYU-365 exp85: controlled images now live only in the direct media composer (DirectMediaFields);
// the composer text is the prompt, and a submit is directMediaRequest on the chosen owner references.
async function fixture(files: unknown[] = [file]) {
  items = files;
  const requests: unknown[] = [], container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const direct = { toolId: 789, schema, prompt: "prompt" };
  let params: Record<string, string> = {};
  function Harness() {
    const [state, setState] = React.useState<Record<string, string>>({});
    params = state;
    return React.createElement("div", null, React.createElement(Fields, { direct, params: state, t: (key: string) => key, setParam: (name: string, value: string) => setState((previous) => ({ ...previous, [name]: value })) }));
  }
  await React.act(async () => root.render(React.createElement(Harness)));
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const change = async (label: string, value: string) => React.act(async () => {
    const input = container.querySelector(`[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(input.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new window.Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
  let sent = false;
  return { container, requests, change,
    submit: async () => { if (sent) return; try { requests.push(directMediaRequest(direct, params, "animate").toolInvocation); sent = true; } catch { /* closed */ } },
    close: async () => { await React.act(async () => root.unmount()); container.remove(); pending = undefined; },
  };
}
test("two-frame workflow submits selected owner references once and never accepts typed image URLs", async () => {
  const view = await fixture();
  try {
    assert.equal(view.container.querySelectorAll("input").length, 0, "no typed image URL input");
    await view.change("首帧图片", file.fileId); await view.submit();
    assert.equal(view.requests.length, 0);
    await view.change("尾帧图片", file.fileId); await view.submit(); await view.submit();
    assert.deepEqual(view.requests, [{ toolId: 789, revision: "5", arguments: { prompt: "animate", first_frame_url: "storage-image:owned-image", last_frame_url: "storage-image:owned-image" } }]);
  } finally { await view.close(); }
});
test("invalid MIME, inactive and oversized files are unavailable; foreign owner pages fail closed", async () => {
  for (const files of [[{ ...file, mimeType: "image/svg+xml" }, { ...file, fileId: "large", size: 4700001 }, { ...file, fileId: "inactive", status: "retained" }], [{ ...file, createdBy: "user:12" }]]) {
    const view = await fixture(files);
    try {
      assert.ok([...view.container.querySelectorAll<HTMLOptionElement>('[aria-label="首帧图片"] option')].filter(option => option.value).every(option => option.disabled));
      await view.submit(); assert.equal(view.requests.length, 0);
      if (files[0].createdBy === "user:12") assert.ok(view.container.querySelector('[role="alert"]'));
    } finally { await view.close(); }
  }
});
test("account changes discard pending owner lists and release both frame selections", async () => {
  let resolve!: (value: unknown) => void;
  pending = new Promise(done => { resolve = done; });
  const view = await fixture();
  try {
    pending = new Promise(() => {}); // the new account's own list is still loading
    await React.act(async () => { version++; window.dispatchEvent(new window.Event("nucleagent:session-change")); });
    await React.act(async () => resolve({ code: 0, data: { owner: "user:11", items: [file], hasMore: false } }));
    assert.equal(view.container.textContent!.includes(file.origName), false);
    await view.submit(); assert.equal(view.requests.length, 0);
  } finally { await view.close(); }
});
