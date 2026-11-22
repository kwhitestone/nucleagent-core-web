import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { settlementRows, turnUsage } from "../src/chat-react/turnUsage.ts";
import { readSettlement } from "../src/addons/conversation/api/settlement.ts";
import { registerPlatformRuntime } from "../src/contracts/platform-runtime.ts";
import { ZH_STRINGS } from "../src/chat-react/islandStringsZh.ts";
import { EN_STRINGS } from "../src/chat-react/islandStringsEn.ts";

// MUYU-365 exp116 RED: Core v0.1.80 settlement `data.pointsStatus` (ok|stale|unavailable|null), `data.pointsReason`
// (snake_case|null) and `data.rateAgeSeconds` (non-negative integer|null, stale only); contract
// nucleagent-core docs/settlement-points-status.md (v0.1.80) and nucleagent-toolgate docs/muyu418-settlement-points-contract.md.
// - ok / all null (old Core): the line is unchanged ("N 贝壳（≈¥X.XXXX）", ¥ = credits / creditsPerCny by the existing code).
// - stale: shells and ¥ stay, plus a small "汇率 N 秒前" (no age: "汇率为旧值").
// - unavailable with rate null: "汇率暂不可用" next to "N 积分" (never a silent "N 积分"); the reason code becomes a
//   Chinese hint in the title only; unknown codes get the generic "汇率暂不可用"; a raw code is never shown.
// - pending / unknown turns: still no number and no ¥.
// - a field of the wrong type is null, never a throw.
// Same path as tests/turnUsageShells.test.ts: readSettlement -> settlementRows -> turnUsage -> <TurnUsage>.

let vite: ViteDevServer;
let TurnUsage: typeof import("../src/chat-react/TurnUsage.tsx").TurnUsage;
let renderToString: typeof import("react-dom/server").renderToString;
let React: typeof import("react");

before(async () => {
  vite = await createServer({ appType: "custom", logLevel: "silent", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  ({ TurnUsage } = await vite.ssrLoadModule("/src/chat-react/TurnUsage.tsx") as { TurnUsage: typeof TurnUsage });
  ({ renderToString } = await import("react-dom/server"));
  React = await import("react");
});
after(async () => { await vite.close(); });

const zh = (key: string) => (ZH_STRINGS as Record<string, string>)[key.replace(/^chatReact\./, "")] ?? key;
const scope = { conversationId: "7", turnId: "turn-a" };
const NAME = { "zh-CN": "贝壳", en: "Seashell" };
const RATE = { creditsAmount: 3000, coinAmount: 100 };
const turn = (over: object = {}) => ({ stepId: "turn-a", state: "settled", credits: "17", points: "3", upstreams: ["aihub-gateway"], callIds: ["1", "2", "3"],
  logicalRequestIds: ["lr-1"], keyIds: ["10"], revision: 1000, ...over });
const answer = (top: object, ...turns: unknown[]) => ({ data: { code: 0, data: { unit: "credits", revision: 1000,
  pointsName: NAME, creditsPerCny: 3000, rate: RATE, pointsStatus: "ok", pointsReason: null, rateAgeSeconds: null, turns, ...top } } });
/** Toolgate's unavailable shape: rate null, so no turn points; pointsName/creditsPerCny stay (except points_unconfigured). */
const unavailable = (reason: unknown, top: object = {}) => answer({ rate: null, pointsStatus: "unavailable", pointsReason: reason, ...top }, turn({ credits: "7", points: null }));
const stale = (age: unknown, top: object = {}) => answer({ pointsStatus: "stale", pointsReason: "rate_refresh_failed", rateAgeSeconds: age, ...top }, turn());

const HINTS: Record<string, string> = {
  rate_refresh_failed: "汇率刷新失败，暂用最近一次的汇率",
  rate_never_fetched: "尚未取到汇率",
  rate_expired: "汇率已过期",
  rate_source_unconfigured: "未配置汇率来源",
  points_unconfigured: "未配置贝壳",
};

let reply: unknown;
async function read(raw: unknown) {
  reply = raw;
  const off = registerPlatformRuntime({ http: { get: async () => { if (reply instanceof Error) throw reply; return reply; } } } as never);
  try {
    return settlementRows(await readSettlement("7", new AbortController().signal).catch((error: unknown) => error));
  } finally {
    off();
  }
}
const html = (rows: Parameters<typeof turnUsage>[1], turnId = "turn-a") =>
  renderToString(React.createElement(TurnUsage, { t: zh, usage: turnUsage({ ...scope, turnId }, rows) }));
const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
/** Visible text of the usage line (zh-CN). */
const text = (rows: Parameters<typeof turnUsage>[1], turnId = "turn-a") => decode(html(rows, turnId).replace(/<!-- -->/g, "").replace(/<[^>]+>/g, ""));
/** The usage line's tooltip (outer title). */
const title = (rows: Parameters<typeof turnUsage>[1], turnId = "turn-a") => decode(/title="([^"]*)"/.exec(html(rows, turnId))?.[1] ?? "");

test("ok and an old Core without the three fields: the line is exactly as before", async () => {
  assert.equal(text(await read(answer({}, turn()))), "3 贝壳（≈¥0.0057）");
  assert.equal(text(await read(answer({ pointsStatus: null, pointsReason: null, rateAgeSeconds: null }, turn()))), "3 贝壳（≈¥0.0057）");
  assert.equal(text(await read(answer({ pointsStatus: undefined, pointsReason: undefined, rateAgeSeconds: undefined }, turn()))), "3 贝壳（≈¥0.0057）");
  assert.equal(title(await read(answer({}, turn()))), "Toolgate额度", "ok keeps the old tooltip");
  // Old Core with no rate and no status at all: the old "N 积分", no note (nothing says the rate is unavailable).
  assert.equal(text(await read(answer({ rate: null, pointsStatus: undefined, pointsReason: undefined, rateAgeSeconds: undefined }, turn({ credits: "7", points: null })))), "7 积分");
});

test("stale: shells and ¥ stay, followed by a small 汇率 N 秒前", async () => {
  assert.equal(text(await read(stale(42))), "3 贝壳（≈¥0.0057） · 汇率 42 秒前");
  assert.equal(text(await read(stale(0))), "3 贝壳（≈¥0.0057） · 汇率 0 秒前");
  assert.match(html(await read(stale(42))), /<small[^>]*>[^]*汇率 [^]*42[^]*秒前[^]*<\/small>/, "the note is small print");
  assert.equal(title(await read(stale(42))), HINTS.rate_refresh_failed);
  // free turn: "0 贝壳" without ¥, the note still says the rate is old
  assert.equal(text(await read(answer({ pointsStatus: "stale", pointsReason: "rate_refresh_failed", rateAgeSeconds: 5 }, turn({ credits: "0", points: "0" })))), "0 贝壳 · 汇率 5 秒前");
});

test("stale without an age (null, missing or malformed): 汇率为旧值", async () => {
  for (const age of [null, undefined, -1, 1.5, "42", Number.NaN, Number.POSITIVE_INFINITY, {}, true]) {
    assert.equal(text(await read(stale(age))), "3 贝壳（≈¥0.0057） · 汇率为旧值", String(age));
  }
});

test("unavailable with rate null: 汇率暂不可用 next to N 积分, never a silent N 积分; the reason is a Chinese hint in the title", async () => {
  for (const [code, hint] of Object.entries(HINTS)) {
    const top = code === "points_unconfigured" ? { pointsName: null, creditsPerCny: null } : {};
    const rows = await read(unavailable(code, top));
    assert.equal(text(rows), "7 积分 · 汇率暂不可用", code);
    assert.equal(title(rows), hint, code);
    assert.doesNotMatch(html(rows), new RegExp(code), `${code}: the raw code is never in the markup`);
  }
});

test("unavailable with an unknown, missing or malformed reason: the generic 汇率暂不可用, no raw code", async () => {
  for (const reason of ["rate_portal_on_fire", null, undefined, 7, "Bad-Code", "x".repeat(80), {}]) {
    const rows = await read(unavailable(reason));
    assert.equal(text(rows), "7 积分 · 汇率暂不可用", String(reason));
    assert.equal(title(rows), "汇率暂不可用", String(reason));
    assert.doesNotMatch(html(rows), /rate_portal_on_fire|Bad-Code|xxxx/);
  }
  // a settled zero is still 0 (credits), with the note
  assert.equal(text(await read(answer({ rate: null, pointsStatus: "unavailable", pointsReason: "rate_expired" }, turn({ credits: "0", points: null })))), "0 积分 · 汇率暂不可用");
});

test("pending and unknown turns stay without number and ¥ whatever the rate status", async () => {
  for (const top of [{ pointsStatus: "stale", pointsReason: "rate_refresh_failed", rateAgeSeconds: 9 }, { rate: null, pointsStatus: "unavailable", pointsReason: "rate_expired" }]) {
    const rows = await read(answer(top, turn({ stepId: "turn-p", state: "pending", credits: null, points: null }),
      turn({ stepId: "turn-u", state: "unknown", credits: null, points: null })));
    assert.equal(text(rows, "turn-p"), "待结算", JSON.stringify(top));
    assert.equal(text(rows, "turn-u"), "计费中", JSON.stringify(top));
    assert.equal(text(rows, "turn-none"), "计费中");
  }
});

test("a pointsStatus of the wrong type or value is null: the line is as before, and the read never throws", async () => {
  for (const status of [1, "STALE", "Unavailable", "", {}, [], true, "degraded"]) {
    const rows = await read(answer({ pointsStatus: status, pointsReason: "rate_refresh_failed", rateAgeSeconds: 42 }, turn()));
    assert.equal(rows.length, 1, String(status));
    assert.equal(text(rows), "3 贝壳（≈¥0.0057）", String(status));
    // with rate null and an unusable status: the old "N 积分" (status null = no claim), never a throw
    assert.equal(text(await read(answer({ rate: null, pointsStatus: status }, turn({ credits: "7", points: null })))), "7 积分", String(status));
  }
  // unavailable while a rate is still sent contradicts the contract (rate null <=> unavailable): it is not shown as unavailable
  assert.equal(text(await read(answer({ pointsStatus: "unavailable", pointsReason: "rate_expired" }, turn()))), "3 贝壳（≈¥0.0057）");
});

test("both locales carry the notes and the five hints; the en line shows no Chinese", async () => {
  for (const strings of [ZH_STRINGS, EN_STRINGS] as Record<string, string>[]) {
    for (const key of ["rateAge", "rateOld", "rateUnavailable", ...Object.keys(HINTS).map((code) => `rateReason_${code}`)]) {
      assert.equal(typeof strings[key], "string", key);
    }
  }
  const en = (key: string) => (EN_STRINGS as Record<string, string>)[key.replace(/^chatReact\./, "")] ?? key;
  const out = renderToString(React.createElement(TurnUsage, { t: en, usage: turnUsage(scope, await read(unavailable("rate_expired"))), locale: "en" } as never));
  assert.doesNotMatch(out, /[一-鿿]/);
  assert.doesNotMatch(out, /rate_expired/);
});

test("the usage files still write no rate or unit name of their own", () => {
  for (const file of ["src/chat-react/turnUsage.ts", "src/chat-react/TurnUsage.tsx", "src/addons/conversation/api/settlement.ts"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/\/\/.*$|\/\*[^]*?\*\//gm, "");
    assert.doesNotMatch(source, /\b3000\b|\b100\b|贝壳|Seashell/, file);
  }
});
