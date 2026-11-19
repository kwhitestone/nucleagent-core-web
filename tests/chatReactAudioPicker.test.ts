import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";

let vite: ViteDevServer;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let Form: typeof import("../src/chat-react/WorkflowForm.tsx").WorkflowForm;
let dispose: () => void;
let dom: JSDOM;
let version = 1;
let list: unknown;
let pending: Promise<Response> | undefined;
const originalFetch = globalThis.fetch;
const file = { fileId: "2b65c83c-9e18-4a2e-b449-8bfc512bd483", origName: "自己的录音.wav", mimeType: "audio/wav", size: 136572, status: "active", createdBy: "user:11" };
const schema = { nativeCapability: "nucleagent.audio.stt.v1", model: "whisper-1", output: "text/plain", invocation: { toolId: 1201, revision: "1" }, inputSchema: { type: "object", additionalProperties: false, required: ["fileId"], properties: { fileId: { type: "string", maxLength: 128 } } } };
before(async () => {
  dom = new JSDOM("", { url: "https://test.example/" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  React = await import("react");
  ({ createRoot } = await import("react-dom/client"));
  ({ WorkflowForm: Form } = await vite.ssrLoadModule("/src/chat-react/WorkflowForm.tsx"));
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  dispose = registerPlatformRuntime({ getAccessToken: () => "fixture", getSessionVersion: () => version, handleUnauthorizedResponse: () => {}, http: {
    get: async (url: string, options: RequestInit) => {
      if (url.includes("/api/v1/files?")) {
        const response = await fetch(url, options);
        if (!response.ok) throw new Error("File list unavailable");
        return { data: await response.json() };
      }
      return { data: url.endsWith("/schema") ? { data: schema } : { data: [{ id: 1201, name: "语音转写", imported: false, status: "ready", nativeCapability: schema.nativeCapability, nativeModel: schema.model }], hasMore: false } };
    },
    post: async () => { throw new Error("No provider writes"); },
  } });
  globalThis.fetch = async (input, options) => {
    assert.equal(options?.method ?? "GET", "GET");
    assert.match(String(input), /^https:\/\/nucleagent-storage\.dev\.ndaeweb\.com\/api\/v1\/files/);
    return pending ?? new Response(JSON.stringify({ code: 0, data: list }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
});
after(async () => { globalThis.fetch = originalFetch; dispose?.(); await vite?.close(); dom?.window.close(); });

async function fixture(rows = [file]) {
  list = { owner: "user:11", items: rows, hasMore: false };
  const container = document.createElement("div"); document.body.append(container);
  const requests: unknown[] = [];
  const root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Form, { t: (key: string) => key, submit: async (request: unknown) => { requests.push(request); } })));
  await React.act(async () => { const details = container.querySelector("details")!; details.open = true; details.dispatchEvent(new window.Event("toggle")); });
  await React.act(async () => { const select = container.querySelector("select")!; select.value = "1201"; select.dispatchEvent(new window.Event("change", { bubbles: true })); });
  return { container, requests,
    select: async (id: string) => React.act(async () => { const select = container.querySelector<HTMLSelectElement>('[aria-label="音频文件"]'); assert.ok(select, "normal STT path must offer an owner audio picker"); select.value = id; select.dispatchEvent(new window.Event("change", { bubbles: true })); }),
    submit: async () => React.act(async () => { container.querySelector("form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); }),
    close: async () => { await React.act(async () => root.unmount()); container.remove(); },
  };
}

test("real workflow picker shows metadata and submits only the selected owner fileId once", async () => {
  const view = await fixture();
  try {
    await view.select(file.fileId);
    assert.match(view.container.textContent!, /自己的录音.wav/);
    assert.match(view.container.textContent!, /audio\/wav/);
    assert.match(view.container.textContent!, /136572/);
    await view.submit(); await view.submit();
    assert.deepEqual(view.requests, [{ toolId: 1201, revision: "1", arguments: { fileId: file.fileId } }]);
    assert.equal(view.container.querySelector('input[type="text"]'), null);
  } finally { await view.close(); }
});

test("inactive, wrong MIME and oversize files have disabled reasons and cannot submit", async () => {
  const view = await fixture([{ ...file, status: "retained" }, { ...file, fileId: "wrong", mimeType: "audio/mpeg" }, { ...file, fileId: "large", size: 1048577 }]);
  try {
    const options = [...view.container.querySelectorAll<HTMLOptionElement>('[aria-label="音频文件"] option')].filter(option => option.value);
    assert.equal(options.length, 3); assert.ok(options.every(option => option.disabled));
    assert.match(view.container.textContent!, /不可用/); assert.match(view.container.textContent!, /WAV/); assert.match(view.container.textContent!, /1 MiB/);
    await view.select(file.fileId); await view.submit(); assert.equal(view.requests.length, 0);
  } finally { await view.close(); }
});

test("foreign owner response is rejected rather than client filtered", async () => {
  const view = await fixture([{ ...file, createdBy: "user:12" }]);
  try { assert.ok(view.container.querySelector('[role="alert"]')); assert.equal(view.container.textContent!.includes(file.origName), false); await view.submit(); assert.equal(view.requests.length, 0); }
  finally { await view.close(); }
});

test("session switch invalidates selected files and late list responses", async () => {
  let resolve!: (response: Response) => void;
  pending = new Promise(done => { resolve = done; });
  const view = await fixture();
  try {
    assert.ok(view.container.querySelector('[role="status"]'));
    await React.act(async () => { version++; window.dispatchEvent(new window.Event("nucleagent:session-change")); });
    await React.act(async () => resolve(new Response(JSON.stringify({ code: 0, data: list }))));
    assert.equal(view.container.textContent!.includes(file.origName), false);
    await view.submit(); assert.equal(view.requests.length, 0);
  } finally { pending = undefined; await view.close(); }
});

test("empty owner list stays empty and remount does not remember a file", async () => {
  const empty = await fixture([]);
  try { assert.match(empty.container.textContent!, /暂无/); await empty.submit(); assert.equal(empty.requests.length, 0); } finally { await empty.close(); }
  const view = await fixture();
  try { assert.equal(view.container.querySelector<HTMLSelectElement>('[aria-label="音频文件"]')?.value, ""); await view.submit(); assert.equal(view.requests.length, 0); } finally { await view.close(); }
});

test("session switch clears an already selected file before any submit", async () => {
  const view = await fixture();
  try {
    await view.select(file.fileId);
    await React.act(async () => { version++; window.dispatchEvent(new window.Event("nucleagent:session-change")); view.container.querySelector("form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); });
    assert.equal(view.requests.length, 0);
    assert.equal(view.container.textContent!.includes(file.origName), false);
  } finally { await view.close(); }
});

test("failed list can retry and a refresh invalidates a revoked selection", async () => {
  pending = Promise.resolve(new Response("", { status: 403 }));
  const view = await fixture();
  try {
    assert.ok(view.container.querySelector('[role="alert"]'));
    pending = undefined;
    await React.act(async () => view.container.querySelector<HTMLButtonElement>('button[type="button"]')!.click());
    await view.select(file.fileId);
    list = { owner: "user:11", items: [{ ...file, status: "retained" }], hasMore: false };
    await React.act(async () => view.container.querySelector<HTMLButtonElement>('button[type="button"]')!.click());
    assert.equal(view.container.querySelector<HTMLSelectElement>('[aria-label="音频文件"]')?.value, "");
    await view.submit(); assert.equal(view.requests.length, 0);
  } finally { pending = undefined; await view.close(); }
});
