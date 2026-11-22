import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";

// MUYU-365 exp118: the tool card reads GET tool-io/{id}?field=record (Core v0.1.83, MUYU-342 fix58b
// record-field-contract) on expand only, and renders source / transport / business / error / duration /
// settlement as independent blocks. The legacy input/output pages are unchanged; when record is not
// available (400/404/422/available=false/no record/bad shape) the card is exactly the legacy card.
// 401/403 never degrade: private content is cleared and the read error shows.

let vite: ViteDevServer;
let unregister: () => void;
let dom: JSDOM;
let ToolIO: typeof import("../src/chat-react/ToolIO.tsx").default;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
type T = (key: string) => string;
let zh: T;
let en: T;
let calls: { field: string; params: Record<string, unknown> }[] = [];
let record: unknown;
let recordReply: (() => unknown) | undefined;

const fail = (status: number) => () => { const e = new Error(`HTTP ${status}`) as Error & { status: number }; e.status = status; throw e; };
const full = () => ({
  schemaVersion: 1, recordKind: "native", messageId: "15172", conversationId: "1033", stepId: "c271", toolCallId: "6765", canReadDetail: true,
  tool: { name: "nucleagent.agentia-t7" },
  source: { identityState: "CAPTURED", kind: "product_mcp", toolId: "2", revision: "4", sourceSystem: "agentia-engine", sourceId: "7", definitionPath: "/api/v1/addons/tool/2" },
  transport: { lifecycleStatus: "failed", outcome: "failed", hops: [{ hop: "executor_to_core", phase: "relay", httpStatus: 200, evidence: "observed_response" }] },
  business: { outcome: "failed", evidence: "tool_protocol" },
  error: { class: "upstream_timeout", origin: "mcp_peer", code: -32602, codeNamespace: "json_rpc", message: "mcp upstream unavailable", upstreamHttpStatus: 502, upstreamHop: "core_to_mcp", reportedDownstreamHttpStatus: null, evidence: "typed_runtime", messageTruncated: false, messageOriginalLength: 24 },
  duration: { ms: 61, boundary: "native_invocation" },
  settlement: { scope: "turn", shared: true, stepId: "c271", state: "settled", credits: "10", points: "2", creditsPerCny: 3000, amountCny: null, currency: "CNY", ledgerSource: "toolgate.conversation-settlement", ledgerRevision: 1, callIds: ["160819"], toolCharge: "not_attributed", reason: null },
});
beforeEach(() => { calls = []; record = full(); recordReply = undefined; });

before(async () => {
  dom = new JSDOM("<div id='root'></div>");
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime({ getSessionVersion: () => 1, http: { get: async (_url: string, options: { params: Record<string, unknown> }) => {
    const params = options.params;
    calls.push({ field: String(params.field), params });
    if (params.field === "record") {
      if (recordReply) return recordReply();
      return { data: { data: { available: true, content: "", nextOffset: -1, revision: "", status: "completed", record } } };
    }
    return { data: { data: { available: true, content: params.field === "input" ? '{"city":"London"}' : '{"temp":12}', nextOffset: -1, revision: "rev", status: "completed" } } };
  } } });
  ({ default: ToolIO } = await vite.ssrLoadModule("/src/chat-react/ToolIO.tsx"));
  React = await import("react"); ({ createRoot } = await import("react-dom/client"));
  const dict = async (locale: "Zh" | "En"): Promise<T> => {
    const island = (await vite.ssrLoadModule(`/src/chat-react/islandStrings${locale}.ts`))[`${locale.toUpperCase()}_STRINGS`];
    const shell = (await vite.ssrLoadModule(`/src/i18n/${locale.toLowerCase()}.ts`)).default;
    return (key) => key.startsWith("chatReact.") ? island[key.slice(10)] ?? key : key.split(".").reduce((node: any, part) => node?.[part], shell) ?? key;
  };
  zh = await dict("Zh"); en = await dict("En");
});
after(async () => { unregister?.(); await vite?.close(); dom?.window.close(); });

async function open(t: T = zh, failed = false) {
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  await React.act(async () => root.render(React.createElement(ToolIO, { messageId: 15172, t, failed })));
  const toggle = () => React.act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  return { container, root, toggle, rec: () => container.querySelector<HTMLElement>("[data-io=record]"), block: (name: string) => container.querySelector<HTMLElement>(`[data-io=record] [data-rec=${name}]`) };
}
const legacyShape = (container: HTMLElement) => [...container.querySelectorAll("section:not([data-io=record]) h4")].map((h) => h.textContent);

test("record is read only on expand, once, without offset or revision; legacy reads are unchanged", async () => {
  const v = await open();
  try {
    assert.equal(calls.length, 0, "nothing is fetched while the card is collapsed (no list-wide prefetch)");
    await v.toggle();
    const rec = calls.filter((c) => c.field === "record");
    assert.equal(rec.length, 1);
    assert.ok(!("revision" in rec[0].params) || rec[0].params.revision === undefined, "record never carries revision");
    assert.ok(!rec[0].params.offset, "record never asks for offset>0");
    assert.deepEqual(calls.filter((c) => c.field !== "record").map((c) => `${c.field}:${c.params.offset}`), ["input:0", "output:0"]);
    assert.deepEqual(legacyShape(v.container), ["输入", "输出"]);
    assert.ok(v.rec(), "record section renders");
    await v.toggle();
    assert.equal(v.rec(), null, "collapse clears the record");
  } finally { await React.act(async () => v.root.unmount()); }
});

test("full record: every block renders on its own, settlement labelled 本轮合计 and never rounded", async () => {
  const v = await open();
  try {
    await v.toggle();
    const source = v.block("source")!.textContent!;
    for (const value of ["product_mcp", "2", "4", "agentia-engine", "7", "/api/v1/addons/tool/2"]) assert.match(source, new RegExp(value.replace(/[/]/g, "\\/")));
    const transport = v.block("transport")!.textContent!;
    assert.match(transport, /failed/); assert.match(transport, /executor_to_core/); assert.match(transport, /200/);
    assert.match(v.block("business")!.textContent!, /failed/);
    const error = v.block("error")!.textContent!;
    assert.match(error, /upstream_timeout/); assert.match(error, /mcp upstream unavailable/); assert.match(error, /上游 HTTP/); assert.match(error, /502/);
    assert.match(v.block("duration")!.textContent!, /61 ms/);
    const settle = v.block("settlement")!.textContent!;
    assert.match(settle, /本轮合计/); assert.match(settle, /10/); assert.match(settle, /3000/);
    assert.doesNotMatch(settle, /¥0\.0033|0\.003/, "the Web never rounds credits/creditsPerCny into an amount");
    assert.match(v.container.textContent!, /London/, "legacy input still shows");
  } finally { await React.act(async () => v.root.unmount()); }
});

test("UNKNOWN source shows 来源未知 with the reason and never guesses from the tool name", async () => {
  record = { ...full(), source: { identityState: "UNKNOWN", reason: "TOOL_NOT_UNIQUE_IN_SNAPSHOT", kind: null, toolId: null, revision: null, sourceSystem: null, sourceId: null, definitionPath: null } };
  const v = await open();
  try {
    await v.toggle();
    const source = v.block("source")!.textContent!;
    assert.match(source, /来源未知/); assert.match(source, /TOOL_NOT_UNIQUE_IN_SNAPSHOT/);
    assert.doesNotMatch(source, /agentia|product_mcp|nucleagent/);
  } finally { await React.act(async () => v.root.unmount()); }
});

test("not_attempted reads 网关拒绝，未外发; transport ok with business failed shows both as they are", async () => {
  record = { ...full(), recordKind: "gateway_rejected", transport: { lifecycleStatus: "failed", outcome: "not_attempted", hops: [] } };
  let v = await open();
  try { await v.toggle(); assert.match(v.block("transport")!.textContent!, /网关拒绝，未外发/); }
  finally { await React.act(async () => v.root.unmount()); }
  record = { ...full(), transport: { lifecycleStatus: "completed", outcome: "ok", hops: [] }, business: { outcome: "failed", evidence: "tool_protocol" } };
  v = await open();
  try {
    await v.toggle();
    assert.match(v.block("transport")!.textContent!, /\bok\b/);
    assert.match(v.block("business")!.textContent!, /failed/);
  } finally { await React.act(async () => v.root.unmount()); }
});

test("record unavailable (400/404/422/500, available=false, no record, wrong schema) falls back to the legacy card silently", async () => {
  const cases: (() => unknown)[] = [fail(400), fail(404), fail(422), fail(500),
    () => ({ data: { data: { available: false, content: "", nextOffset: -1, revision: "", reason: "x" } } }),
    () => ({ data: { data: { available: true, content: "", nextOffset: -1, revision: "" } } }),
    () => ({ data: { data: { available: true, content: "", nextOffset: -1, revision: "", record: { ...full(), schemaVersion: 2 } } } }),
    () => ({ data: { data: { available: true, content: "", nextOffset: -1, revision: "", record: "nope" } } }),
    () => undefined];
  for (const reply of cases) {
    recordReply = reply;
    const v = await open();
    try {
      await v.toggle();
      assert.equal(v.rec(), null);
      assert.equal(v.container.querySelector("[role=alert]"), null, "no error for an unsupported record");
      assert.deepEqual(legacyShape(v.container), ["输入", "输出"]);
      assert.match(v.container.textContent!, /London/);
    } finally { await React.act(async () => v.root.unmount()); }
  }
});

test("401/403 on record never degrade: private content is cleared and the read error shows", async () => {
  for (const status of [401, 403]) {
    recordReply = fail(status);
    const v = await open();
    try {
      await v.toggle();
      assert.ok(v.container.querySelector("[role=alert]"));
      assert.doesNotMatch(v.container.textContent!, /London|temp/);
      assert.equal(v.rec(), null);
    } finally { await React.act(async () => v.root.unmount()); }
  }
});

test("missing or malformed blocks show 暂无数据 per block, never throw", async () => {
  record = { ...full(), source: null, transport: "x", business: undefined, error: null, duration: { ms: null, boundary: "unknown" }, settlement: 7 };
  const v = await open();
  try {
    await v.toggle();
    for (const name of ["source", "transport", "business", "error", "duration", "settlement"]) assert.match(v.block(name)!.textContent!, /暂无数据/, name);
  } finally { await React.act(async () => v.root.unmount()); }
});

test("settlement: pending is 待结算, unknown is 未知 with reason, an exact amount shows ¥; never 0 for unknown", async () => {
  const base = full().settlement;
  record = { ...full(), settlement: { ...base, state: "pending", credits: null, points: null, amountCny: null } };
  let v = await open();
  try { await v.toggle(); const s = v.block("settlement")!.textContent!; assert.match(s, /待结算/); assert.doesNotMatch(s, /\b0\b/); }
  finally { await React.act(async () => v.root.unmount()); }
  record = { ...full(), settlement: { ...base, state: "unknown", credits: null, points: null, amountCny: null, reason: "ledger_turn_unknown" } };
  v = await open();
  try { await v.toggle(); const s = v.block("settlement")!.textContent!; assert.match(s, /未知/); assert.match(s, /ledger_turn_unknown/); assert.doesNotMatch(s, /\b0\b|¥/); }
  finally { await React.act(async () => v.root.unmount()); }
  record = { ...full(), settlement: { ...base, credits: "1500", amountCny: "0.5" } };
  v = await open();
  try { await v.toggle(); const s = v.block("settlement")!.textContent!; assert.match(s, /本轮合计/); assert.match(s, /¥0\.5/); }
  finally { await React.act(async () => v.root.unmount()); }
});

test("upstream HTTP status null is shown as not observed, not as success", async () => {
  record = { ...full(), error: { ...full().error, upstreamHttpStatus: null } };
  const v = await open();
  try { await v.toggle(); const e = v.block("error")!.textContent!; assert.match(e, /上游 HTTP/); assert.match(e, /暂无数据/); }
  finally { await React.act(async () => v.root.unmount()); }
});

test("legacy record (private row missing) shows the not-captured note and still renders blocks", async () => {
  recordReply = () => ({ data: { data: { available: true, content: "", nextOffset: -1, revision: "", reason: "未采集完整输入输出", record: { ...full(), recordKind: "legacy", transport: { lifecycleStatus: "completed", outcome: "ok", hops: [] }, business: { outcome: "unknown", evidence: "unknown" } } } } });
  const v = await open(en);
  try {
    await v.toggle();
    assert.ok(v.rec());
    assert.match(v.rec()!.textContent!, /not captured/i);
    assert.doesNotMatch(v.container.textContent!, /[　-〿一-鿿＀-￯]/, "English session shows no Chinese, Core's reason prose included");
  } finally { await React.act(async () => v.root.unmount()); }
});

test("English session: record labels come from the island dictionary; component holds no hardcoded copy", async () => {
  record = { ...full(), source: { identityState: "UNKNOWN", reason: "CAPTURE_EXPIRED", kind: null, toolId: null, revision: null, sourceSystem: null, sourceId: null, definitionPath: null }, transport: { lifecycleStatus: "failed", outcome: "not_attempted", hops: [] } };
  const v = await open(en);
  try {
    await v.toggle();
    const text = v.rec()!.textContent!;
    assert.doesNotMatch(text, /[　-〿一-鿿＀-￯]/);
    assert.match(text, /Source unknown/); assert.match(text, /not sent/i); assert.match(text, /turn total/i);
  } finally { await React.act(async () => v.root.unmount()); }
  assert.doesNotMatch(readFileSync(new URL("../src/chat-react/ToolIO.tsx", import.meta.url), "utf8"), /[　-〿一-鿿＀-￯]/);
});

test("a session change clears the record with the rest of the private view", async () => {
  const v = await open();
  try {
    await v.toggle();
    assert.ok(v.rec());
    await React.act(async () => window.dispatchEvent(new dom.window.Event("nucleagent:session-change")));
    assert.equal(v.rec(), null);
    assert.doesNotMatch(v.container.textContent!, /product_mcp|London/);
  } finally { await React.act(async () => v.root.unmount()); }
});
