import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import axios from "axios";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";

let vite: ViteDevServer;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let FileChipView: typeof import("../src/chat-react/ChatApp.tsx").FileChipView;
let dispose: () => void;
let reads: string[] = [];
let revoked: string[] = [];
let denied = false;
let delayed: (() => void) | undefined;
let delay = false;
let sequence = 0;
const originalFetch = globalThis.fetch;
const originalAdapter = axios.defaults.adapter;
const file = { id: "owner-image", name: "result.jpg", mimeType: "image/jpeg", size: 4, verified: true };
const translate = (key: string) => key;
const wav = new Uint8Array(48);
wav.set(new TextEncoder().encode("RIFF"));
wav.set(new TextEncoder().encode("WAVEfmt "), 8);
const wavHash = Buffer.from(await crypto.subtle.digest("SHA-256", wav)).toString("hex");

before(async () => {
  const dom = new JSDOM("", { url: "https://test.example/" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, AbortController: dom.window.AbortController });
  URL.createObjectURL = () => `blob:test-${++sequence}`;
  URL.revokeObjectURL = (url) => revoked.push(url);
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  React = await import("react");
  ({ createRoot } = await import("react-dom/client"));
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  dispose = registerPlatformRuntime({ getAccessToken: () => "fixture", getSessionVersion: () => 1, handleUnauthorizedResponse() {}, http: {} });
  globalThis.fetch = async (input) => {
    reads.push(String(input));
    if (delay) await new Promise<void>((resolve) => { delayed = resolve; });
    if (String(input).endsWith('.wav')) return new Response(wav, { headers: { "Content-Type": "audio/wav" } });
    return denied ? new Response(null, { status: 403 }) : new Response(new Uint8Array([255, 216, 255, 217]), { headers: { "Content-Type": "image/jpeg", "Content-Length": "4", "Content-Disposition": 'attachment; filename="result.jpg"' } });
  };
  axios.defaults.adapter = async (config) => {
    reads.push(config.url!);
    if (denied) throw new Error("denied");
    return { data: { data: { url: `https://cdn.example.com/owned-${++sequence}.${config.url?.includes('owner-audio') ? 'wav' : 'mp4'}` } }, status: 200, statusText: "OK", headers: {}, config };
  };
  ({ FileChipView } = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx"));
});
after(async () => { globalThis.fetch = originalFetch; axios.defaults.adapter = originalAdapter; dispose?.(); await vite?.close(); });

test("real file-chip path previews verified images, reauthorizes refresh and rejects late responses after session change", async () => {
  reads = []; revoked = []; denied = false;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const render = async (value = file) => React.act(async () => root.render(React.createElement(FileChipView, { file: value, t: translate })));
  try {
    await render();
    assert.equal(reads.length, 1);
    assert.match(reads[0]!, /\/files\/owner-image\/content$/);
    const first = container.querySelector("img")?.src;
    assert.match(first ?? "", /^blob:/);
    assert.equal(container.querySelector("img")?.alt, file.name);
    denied = true;
    await React.act(async () => (container.querySelector('.mc-preview button') as HTMLButtonElement).click());
    assert.equal(container.querySelector("img"), null);
    assert.equal(reads.length, 2);
    assert(revoked.includes(first!));
    assert.match(container.textContent!, /mediaReadFailed/);
    denied = false; delay = true;
    await React.act(async () => (container.querySelector('.mc-preview button') as HTMLButtonElement).click());
    await React.act(async () => { window.dispatchEvent(new window.Event("nucleagent:session-change")); delayed!(); });
    assert.equal(container.querySelector("img"), null);
    delay = false;
    await render({ ...file, id: "other-image" });
    assert(container.querySelector("img"));
    await render({ ...file, verified: false });
    assert.equal(container.querySelector("img"), null);
    const count = reads.length;
    await render({ ...file, mimeType: "image/svg+xml" });
    assert.equal(reads.length, count);
    assert.equal(container.querySelector("img"), null);
  } finally { delay = false; await React.act(async () => root.unmount()); container.remove(); }
});

test("archived video uses newly authorized download URLs and exposes retry after expiry without starting a job", async () => {
  reads = []; denied = false;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await React.act(async () => root.render(React.createElement(FileChipView, { file: { ...file, id: "owner-video", name: "result.mp4", mimeType: "video/mp4" }, t: translate })));
    const video = container.querySelector("video")!;
    assert(video?.controls);
    assert.equal(video.preload, "metadata");
    const first = video.src;
    await React.act(async () => video.dispatchEvent(new window.Event("error")));
    assert.equal(container.querySelector("video"), null);
    await React.act(async () => (container.querySelector('.mc-preview button') as HTMLButtonElement).click());
    assert.notEqual(container.querySelector("video")?.src, first);
    assert.deepEqual(reads, ["/api/v1/files/owner-video/download", "/api/v1/files/owner-video/download"]);
    await React.act(async () => window.dispatchEvent(new window.Event("nucleagent:session-change")));
    assert.equal(container.querySelector("video"), null);
  } finally { await React.act(async () => root.unmount()); container.remove(); }
});

test("audio remains on demand and still rejects bytes that fail the existing digest contract", async () => {
  reads = []; denied = false;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await React.act(async () => root.render(React.createElement(FileChipView, { file: { ...file, id: "owner-audio", name: "result.wav", mimeType: "audio/wav", size: 48, sha256: "0".repeat(64) }, t: translate })));
    assert.equal(reads.length, 0);
    assert.equal(container.querySelector("audio"), null);
    await React.act(async () => (container.querySelector('.mc-preview button') as HTMLButtonElement).click());
    assert.equal(reads.length, 2);
    assert.equal(container.querySelector("audio"), null);
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
    assert.match(container.textContent!, /mediaReadFailed/);
    await React.act(async () => root.render(React.createElement(FileChipView, { file: { ...file, id: "owner-audio", name: "result.wav", mimeType: "audio/wav", size: 48, sha256: wavHash }, t: translate })));
    assert.equal(reads.length, 2);
    await React.act(async () => (container.querySelector('.mc-preview button') as HTMLButtonElement).click());
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
    assert(container.querySelector("audio")?.controls);
    assert.match(container.querySelector("audio")?.src ?? "", /^blob:/);
  } finally { await React.act(async () => root.unmount()); container.remove(); }
});
