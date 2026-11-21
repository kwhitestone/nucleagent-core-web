import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";

// MUYU-365 exp106 ② (user acceptance item): a tool call card expands to its input, output and error.
// Core today serves only the legacy tool-io pages (field=input|output, MUYU-342 web-field-contract §1 "legacy remains
// compatible"); the typed record fields (error, truncated, retainedLength, originalLength, ...) are a proposal. So the card
// renders whatever the page carries: known contract fields when present, and an explicit 暂无详情 state when nothing
// usable came back. Unknown or malformed fields never throw and never blank the view. The `*:*:*` gate stays as is.

let vite: ViteDevServer;
let unregister: () => void;
let dom: JSDOM;
let ToolIO: typeof import("../src/chat-react/ToolIO.tsx").default;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
type Reply = (field: string, offset: number) => unknown;
let reply: Reply;
let calls: string[] = [];
type T = (key: string) => string;
let zh: T;
let en: T;
const page = (over: object = {}) => ({ available: true, content: "", nextOffset: -1, revision: "rev", status: "completed", ...over });
const legacy = (input: string, output: string, over: object = {}): Reply => (field) => ({ data: { data: page({ content: field === "input" ? input : output, ...over }) } });
beforeEach(() => { calls = []; reply = legacy('{"city":"London"}', '{"temp":12}'); });

before(async () => {
  dom = new JSDOM("<div id='root'></div>");
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime({ getSessionVersion: () => 1, http: { get: async (_url: string, options: { params: { field: string; offset: number } }) => {
    const { field, offset } = options.params;
    calls.push(`${field}:${offset}`);
    const value = reply(field, offset);
    if (value instanceof Error) throw value;
    return value;
  } } });
  ({ default: ToolIO } = await vite.ssrLoadModule("/src/chat-react/ToolIO.tsx"));
  React = await import("react");
  ({ createRoot } = await import("react-dom/client"));
  const dict = async (locale: "Zh" | "En"): Promise<T> => {
    const island = (await vite.ssrLoadModule(`/src/chat-react/islandStrings${locale}.ts`))[`${locale.toUpperCase()}_STRINGS`];
    const shell = (await vite.ssrLoadModule(`/src/i18n/${locale.toLowerCase()}.ts`)).default;
    return (key) => key.startsWith("chatReact.") ? island[key.slice(10)] ?? key : key.split(".").reduce((node: any, part) => node?.[part], shell) ?? key;
  };
  zh = await dict("Zh");
  en = await dict("En");
});
after(async () => { unregister?.(); await vite?.close(); dom?.window.close(); });

/** Mount one card, run `fn`, always unmount. Every wait is a fixed number of act() turns (memory guard: no open polling). */
async function card(props: Record<string, unknown>, fn: (view: { root: HTMLElement; toggle(): Promise<void>; text(): string; headings(): string[] }) => Promise<void>) {
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  try {
    await React.act(async () => root.render(React.createElement(ToolIO, { messageId: 21, t: zh, ...props } as never)));
    await fn({
      root: container,
      toggle: () => React.act(async () => container.querySelector<HTMLButtonElement>(".mc-tool-io > button")!.click()),
      text: () => container.textContent ?? "",
      headings: () => [...container.querySelectorAll("h4")].map((h) => h.textContent ?? ""),
    });
  } finally {
    await React.act(async () => root.unmount());
  }
}

test("collapsed by default: no request, no private text; collapsing clears what was shown", async () => {
  await card({}, async ({ root, toggle, text }) => {
    assert.equal(root.querySelector(".mc-tool-io > button")!.getAttribute("aria-expanded"), "false");
    assert.deepEqual(calls, []);
    assert.doesNotMatch(text(), /London|temp/);
    await toggle();
    assert.equal(root.querySelector(".mc-tool-io > button")!.getAttribute("aria-expanded"), "true");
    await toggle();
    assert.equal(root.querySelector(".mc-tool-io > button")!.getAttribute("aria-expanded"), "false");
    assert.doesNotMatch(text(), /London|temp/);
  });
});

test("expanded: input and output are both shown, object input as key/value, JSON output pretty-printed", async () => {
  await card({}, async ({ root, toggle, headings }) => {
    await toggle();
    assert.deepEqual(calls, ["input:0", "output:0"]);
    assert.deepEqual(headings(), ["输入", "输出"]);
    assert.equal(root.querySelector("dt")!.textContent, "city");
    assert.equal(root.querySelector("dd")!.textContent, "London");
    assert.equal(root.querySelector("pre")!.textContent, '{\n  "temp": 12\n}');
  });
});

test("error state: a failed tool shows its output under 错误, and a typed error shows class, code and message", async () => {
  reply = legacy('{"q":"x"}', "upstream said 500", { status: "failed" });
  await card({ failed: true }, async ({ toggle, headings, text }) => {
    await toggle();
    assert.deepEqual(headings(), ["输入", "错误"]);
    assert.match(text(), /upstream said 500/);
  });
  reply = (field) => ({ data: { data: page({ content: field === "input" ? "{}" : "", status: "failed",
    error: { class: "upstream_timeout", code: -32003, codeNamespace: "json_rpc", message: "timed out after 21s", upstreamHttpStatus: null } }) } });
  await card({ failed: true }, async ({ root, toggle, text }) => {
    await toggle();
    const error = root.querySelector("[data-io=error]");
    assert.ok(error, "a typed error has its own section");
    assert.match(error!.textContent!, /upstream_timeout/);
    assert.match(error!.textContent!, /-32003/);
    assert.match(error!.textContent!, /timed out after 21s/);
    assert.doesNotMatch(text(), /null|undefined|\[object Object\]/);
  });
  // A read failure is not a tool error: it is the generic retry hint, and nothing private stays on screen.
  reply = () => Object.assign(new Error("403"), { status: 403 });
  await card({}, async ({ root, toggle, text }) => {
    await toggle();
    assert.equal(root.querySelector("[role=alert]")!.textContent, "无法读取，请重新展开。");
    assert.doesNotMatch(text(), /London/);
  });
});

test("long content: kept in a bounded scroll box, truncation is labelled with retained/original length, and more loads by page", async () => {
  const big = "x".repeat(4096);
  reply = (field, offset) => ({ data: { data: page(field === "input" ? { content: "{}" }
    : { content: offset ? "tail" : big, nextOffset: offset ? -1 : 4096, truncated: true, retainedLength: 4100, originalLength: 90000 }) } });
  await card({}, async ({ root, toggle, text }) => {
    await toggle();
    const output = root.querySelector<HTMLElement>("[data-io=output]")!;
    assert.equal(output.querySelector("pre")!.textContent!.length, 4096);
    assert.match(output.textContent!, /已截断/);
    assert.match(output.textContent!, /4100/);
    assert.match(output.textContent!, /90000/);
    await React.act(async () => [...root.querySelectorAll("button")].find((b) => b.textContent === "加载更多输出")!.click());
    assert.deepEqual(calls, ["input:0", "output:0", "output:4096"]);
    assert.match(text(), /xtail$|xtail[^x]/);
  });
  const css = readFileSync(new URL("../src/chat-react/chat.css", import.meta.url), "utf8");
  assert.match(css, /\.mc-tool-io pre \{[^}]*max-height: 400px[^}]*overflow: auto/);
});

test("unknown and missing fields: extra fields are ignored, malformed pages never throw, nothing usable shows 暂无详情", async () => {
  reply = (field) => ({ data: { data: { ...page({ content: field === "input" ? '{"a":1}' : "ok" }), schemaVersion: 9, recordKind: "typed", transport: [{ hop: "x" }], settlement: [], whatever: { deep: [1] } } } });
  await card({}, async ({ toggle, headings, text }) => {
    await toggle();
    assert.deepEqual(headings(), ["输入", "输出"]);
    assert.match(text(), /ok/);
    assert.doesNotMatch(text(), /暂无详情|schemaVersion|whatever/);
  });
  for (const odd of [null, undefined, {}, [], "x", { data: null }, { data: { data: null } }, { data: { data: { content: 7, nextOffset: "x" } } },
    { data: { data: { available: false, content: "", nextOffset: -1, revision: "", reason: "未采集完整输入输出" } } }]) {
    reply = () => odd;
    await card({}, async ({ root, toggle, text }) => {
      await toggle();
      assert.match(text(), /暂无详情/, JSON.stringify(odd));
      assert.equal(root.querySelector("[role=alert]"), null, "an empty record is not a network failure");
      assert.doesNotMatch(text(), /undefined|null|NaN|\[object Object\]/);
    });
  }
  // One field captured, the other not: the captured one shows, the other says 未采集.
  reply = (field) => ({ data: { data: field === "input" ? page({ content: '{"a":1}' }) : { available: false, content: "", nextOffset: -1, revision: "" } } });
  await card({}, async ({ toggle, text }) => {
    await toggle();
    assert.match(text(), /未采集/);
    assert.doesNotMatch(text(), /暂无详情/);
  });
});

test("English session: every new label comes from the island dictionary; the component holds no hard-coded copy", async () => {
  const CJK = /[　-〿一-鿿＀-￯]/;
  reply = (field) => ({ data: { data: page({ content: field === "input" ? "{}" : "boom", truncated: true, retainedLength: 4, originalLength: 9, status: "failed",
    error: { class: "tool_error", code: "E1", message: "bad" } }) } });
  await card({ t: en, failed: true }, async ({ toggle, headings, text }) => {
    await toggle();
    assert.deepEqual(headings(), ["Input", "Error"]);
    assert.doesNotMatch(text(), CJK);
    assert.match(text(), /Truncated/);
  });
  reply = () => ({ data: { data: null } });
  await card({ t: en }, async ({ toggle, text }) => {
    await toggle();
    assert.match(text(), /No details yet/);
    assert.doesNotMatch(text(), CJK);
  });
  assert.doesNotMatch(readFileSync(new URL("../src/chat-react/ToolIO.tsx", import.meta.url), "utf8"), CJK);
});

test("permission gate unchanged: the card's private control is still mounted only under can(\"*:*:*\")", () => {
  const source = readFileSync(new URL("../src/chat-react/ChatApp.tsx", import.meta.url), "utf8");
  assert.match(source, /useEmbeddedAuthorization\(\)\.can\("\*:\*:\*"\) && <ToolIO /);
  assert.equal((source.match(/<ToolIO /g) ?? []).length, 1, "one mount point");
  assert.match(source, /<ToolIO [^>]*failed=\{/, "the card is told whether the tool failed");
});
