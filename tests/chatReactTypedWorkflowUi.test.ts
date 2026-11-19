import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";
import { scalarSchema, videoSchema, engineFramesInput } from "./fixtures/workflowTyped.ts";
import type { WorkflowSchema } from "../src/chat-react/workflowParams.ts";

let vite: ViteDevServer;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let WorkflowForm: typeof import("../src/chat-react/WorkflowForm.tsx").WorkflowForm;
let dispose: () => void;
let definition: WorkflowSchema;
let dom: JSDOM;
let nativeAudio = false;
before(async () => {
  dom = new JSDOM("", { url: "https://test.example/" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  React = await import("react");
  ({ createRoot } = await import("react-dom/client"));
  ({ WorkflowForm } = await vite.ssrLoadModule("/src/chat-react/WorkflowForm.tsx"));
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  dispose = registerPlatformRuntime({ getAccessToken: () => "fixture", getSessionVersion: () => 1, http: {
    get: async (url: string) => ({ data: url.endsWith("/schema") ? { data: definition } : { data: [{ id: definition.invocation!.toolId, name: "fixture", imported: !nativeAudio, status: "ready", ...(nativeAudio ? { nativeCapability: definition.nativeCapability, nativeModel: definition.model } : {}) }], hasMore: false } }),
    post: async () => { throw new Error("network writes forbidden"); },
  } });
});

test("normal picker renders native audio and submits one bound input and voice intent", async () => {
  nativeAudio = true;
  const view = await fixture({ nativeCapability: "nucleagent.audio.tts.v1", model: "qwen3-tts-flash", output: "audio/wav", invocation: { toolId: 71, revision: "9" }, inputSchema: {
    type: "object", additionalProperties: false, required: ["input", "voice"], properties: { input: { type: "string", maxLength: 256 }, voice: { type: "string", maxLength: 64 } },
  } });
  try {
    await view.change("input", "你好");
    await view.change("voice", "fixture");
    await view.submit();
    await view.submit();
    assert.deepEqual(view.requests, [{ toolId: 71, revision: "9", arguments: { input: "你好", voice: "fixture" } }]);
  } finally { await view.close(); nativeAudio = false; }
});
after(async () => { dispose?.(); await vite?.close(); dom?.window.close(); });

test("native STT cannot bypass an unavailable owner picker through a manual file ID", async () => {
  nativeAudio = true;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("", { status: 403 });
  const view = await fixture({ nativeCapability: "nucleagent.audio.stt.v1", model: "whisper-1", output: "text/plain", invocation: { toolId: 72, revision: "10" }, inputSchema: {
    type: "object", additionalProperties: false, required: ["fileId"], properties: { fileId: { type: "string", maxLength: 128 } },
  } });
  try {
    assert.equal(view.container.querySelector('input[type="text"]'), null);
    await view.submit();
    assert.equal(view.requests.length, 0);
  } finally { await view.close(); nativeAudio = false; globalThis.fetch = previousFetch; }
});

async function fixture(schema: WorkflowSchema) {
  definition = schema;
  const requests: unknown[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(React.createElement(WorkflowForm, {
    t: (key: string) => key, submit: async (request) => { requests.push(request); },
  })));
  await React.act(async () => { const details = container.querySelector("details")!; details.open = true; details.dispatchEvent(new window.Event("toggle")); });
  await React.act(async () => { const select = container.querySelector("select")!; select.value = String(schema.invocation!.toolId); select.dispatchEvent(new window.Event("change", { bubbles: true })); });
  const control = (name: string) => {
    const label = [...container.querySelectorAll("label")].find((label) => label.textContent?.startsWith(name));
    assert.ok(label, `field ${name} rendered`);
    const input = label.querySelector("input,select") as HTMLInputElement | HTMLSelectElement;
    assert.ok(input, `control ${name} rendered`);
    return input;
  };
  return {
    container, requests, control,
    change: async (name: string, value: string) => {
      const input = control(name);
      await React.act(async () => {
        const prototype = input.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new window.Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
      });
    },
    submit: async () => React.act(async () => { container.querySelector("form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); }),
    close: async () => { await React.act(async () => root.unmount()); container.remove(); },
  };
}

test("typed form renders saved integer enum and boolean, preserving false and zero at submit", async () => {
  const schema = { ...scalarSchema, inputSchema: { ...scalarSchema.inputSchema, required: ["duration", "watermark", "length"] } };
  const view = await fixture(schema);
  try {
    assert.equal(view.control("duration").required, true);
    assert.equal(view.control("watermark").required, true);
    assert.equal(view.control("duration").value, "");
    assert.equal(view.control("watermark").value, "");
    await view.submit();
    assert.equal(view.requests.length, 0);
    await view.change("duration", "5");
    await view.change("watermark", "false");
    await view.change("length", "0");
    await view.change("cfg", "0.5");
    await view.submit();
    assert.deepEqual(view.requests, [{ toolId: 38, revision: "7", arguments: { duration: 5, watermark: false, length: 0, cfg: 0.5 } }]);
  } finally { await view.close(); }
});

test("required image stays visible and unsatisfied without a controlled source", async () => {
  const view = await fixture(videoSchema);
  try {
    assert.equal(view.control("image_url").required, true);
    assert.equal(view.control("image_url").value, "");
    assert.equal((view.control("image_url") as HTMLInputElement).readOnly, true);
    assert.equal(view.control("prompt").required, true);
    assert.deepEqual([...((view.control("duration") as HTMLSelectElement).options)].map((option) => option.value), ["", "5", "10"]);
    await view.change("prompt", "slow movement");
    await view.change("duration", "5");
    await view.submit();
    assert.equal(view.requests.length, 0);
    assert.equal(view.container.querySelector("button")!.disabled, true);
  } finally { await view.close(); }
});

test("actual start/end-frame source cannot bypass the controlled image gate through workflow text inputs", async () => {
  const schema = { ...videoSchema, inputSchema: { type: "object", additionalProperties: false,
    required: ["prompt", "first_frame_url", "last_frame_url", "duration", "resolution"],
    properties: Object.fromEntries(["prompt", "first_frame_url", "last_frame_url", "duration", "resolution"].map(name => [name, engineFramesInput.properties[name]])),
  } };
  const view = await fixture(schema);
  try {
    for (const name of ["first_frame_url", "last_frame_url"]) {
      assert.equal((view.control(name) as HTMLInputElement).readOnly, true);
      await view.change(name, "https://example.test/uncontrolled.png");
    }
    await view.change("prompt", "move");
    await view.change("duration", "5");
    await view.change("resolution", "1080p");
    await view.submit();
    assert.equal(view.requests.length, 0);
    assert.equal(view.container.querySelector("button")!.disabled, true);
  } finally { await view.close(); }
});

test("clearing optional numbers omits them and required false is not a default", async () => {
  const view = await fixture({ ...scalarSchema, inputSchema: { ...scalarSchema.inputSchema, required: ["watermark"] } });
  try {
    await view.change("length", "4");
    await view.change("length", "");
    await view.submit();
    assert.equal(view.requests.length, 0);
    await view.change("watermark", "false");
    await view.submit();
    assert.deepEqual(view.requests, [{ toolId: 38, revision: "7", arguments: { watermark: false } }]);
  } finally { await view.close(); }
});

test("fractional integer text cannot round into an allowed integer", async () => {
  const view = await fixture({ ...scalarSchema, inputSchema: { ...scalarSchema.inputSchema, required: ["length"] } });
  try {
    await view.change("length", "5.0000000000000001");
    await view.submit();
    assert.equal(view.requests.length, 0);
  } finally { await view.close(); }
});
