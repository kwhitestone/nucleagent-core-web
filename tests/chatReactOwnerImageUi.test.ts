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
    return React.createElement("div", null, React.createElement(Fields, { direct, params: state, frame: true, t: (key: string) => key, setParam: (name: string, value: string) => setState((previous) => ({ ...previous, [name]: value })) }));
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
// MUYU-365 exp98 W2e: frames come from the composer's "+" images (mediaFrames), not a picker in the panel.
test("two-frame workflow takes the composer images in order, once, and never accepts typed image URLs", async () => {
  const view = await fixture();
  const { mediaFrames } = await vite.ssrLoadModule("/src/chat-react/workflowParams.ts");
  try {
    assert.equal(view.container.querySelectorAll("input,select").length, 0, "no typed image URL input and no picker");
    const direct = { toolId: 789, schema, prompt: "prompt" };
    const one = mediaFrames(direct, [{ id: "owned-image", mimeType: "image/png" }]);
    assert.equal(one.missing, "last_frame_url", "the end frame is still needed");
    const both = mediaFrames(direct, [{ id: "notes", mimeType: "application/pdf" }, { id: "first", mimeType: "image/png" }, { id: "last", mimeType: "image/jpeg" }]);
    assert.deepEqual(both, { params: { first_frame_url: "storage-image:first", last_frame_url: "storage-image:last" }, used: ["first", "last"] });
    assert.deepEqual(directMediaRequest(direct, both.params, "animate").toolInvocation,
      { toolId: 789, revision: "5", arguments: { prompt: "animate", first_frame_url: "storage-image:first", last_frame_url: "storage-image:last" } });
    assert.throws(() => directMediaRequest(direct, { first_frame_url: "https://example.com/a.png", last_frame_url: "storage-image:last" }, "animate"));
  } finally { await view.close(); }
});
test("only well-formed image attachments can become frames; others are left as attachments", async () => {
  const { mediaFrames } = await vite.ssrLoadModule("/src/chat-react/workflowParams.ts");
  const direct = { toolId: 789, schema, prompt: "prompt" };
  const frames = mediaFrames(direct, [{ id: "../x", mimeType: "image/png" }, { id: "svg", mimeType: "text/plain" }, { id: "ok", mimeType: "image/png" }]);
  assert.deepEqual(frames, { params: { first_frame_url: "storage-image:ok" }, used: ["ok"], missing: "last_frame_url" });
  const view = await fixture();
  try { assert.match(view.container.textContent!, /chatReact.mediaFrameHint/, "the panel says how to add the frame"); } finally { await view.close(); }
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
