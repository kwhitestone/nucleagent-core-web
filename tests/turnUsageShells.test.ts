import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { settlementRows, turnUsage } from "../src/chat-react/turnUsage.ts";
import { readSettlement } from "../src/addons/conversation/api/settlement.ts";
import { registerPlatformRuntime } from "../src/contracts/platform-runtime.ts";
import { ZH_STRINGS } from "../src/chat-react/islandStringsZh.ts";

// MUYU-365 exp103 RED (user item 2): "N 贝壳（≈¥X.XXXX）" from Core's settlement contract
// (exp103/CONTRACT-PROPOSAL.md). Web only consumes: N is Core's turn.points (per call rounded up, then summed,
// as Toolgate's usage page), the unit name is Core's pointsName, ¥ = credits / creditsPerCny (4 decimals, "≈").
// Nothing here may come from a rate written in the Web: no 3000, no 100.
// Everything goes through readSettlement -> settlementRows -> turnUsage -> <TurnUsage>, so the tests pin the
// contract and the visible text, not the row shape in between.

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
const turn = (over: object = {}) => ({ stepId: "turn-a", state: "settled", credits: "3", points: "1", upstreams: ["aihub-gateway"], callIds: ["1"],
  logicalRequestIds: ["lr-1"], keyIds: ["10"], revision: 1000, ...over });
const answer = (top: object, ...turns: unknown[]) => ({ data: { code: 0, data: { unit: "credits", revision: 1000,
  pointsName: NAME, creditsPerCny: 3000, rate: RATE, turns, ...top } } });

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
/** Visible text of the usage line for turn-a (zh-CN). */
const text = (rows: Parameters<typeof turnUsage>[1], turnId = "turn-a") =>
  renderToString(React.createElement(TurnUsage, { t: zh, usage: turnUsage({ ...scope, turnId }, rows) }))
    .replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

test("settled: N 贝壳（≈¥X.XXXX） with N from Core's per-call points and ¥ from credits / creditsPerCny", async () => {
  assert.equal(text(await read(answer({}, turn()))), "1 贝壳（≈¥0.0010）");
  assert.equal(text(await read(answer({}, turn({ credits: "10", points: "1" })))), "1 贝壳（≈¥0.0033）");
  // PROD 1007 shape: three calls 4/3/10 credits are 1+1+1 贝壳 on the usage page; the Web must show Core's 3,
  // never re-derive ceil(17/30)=1 from the turn total.
  assert.equal(text(await read(answer({}, turn({ credits: "17", points: "3" })))), "3 贝壳（≈¥0.0057）");
});

// exp106 (user, 2026-11-21): free is "0 贝壳" with no ¥ at all (replaces exp103's "0 贝壳（≈¥0）").
test("settled and zero is the only real zero: 0 贝壳, without ¥", async () => {
  assert.equal(text(await read(answer({}, turn({ credits: "0", points: "0" })))), "0 贝壳");
});

// exp106: the real Core GET answers of PROD 1007/1027, PRE 253 and TEST 1461 (ids replaced, tests/fixtures/settlement-shells.json).
test("real Core answers (PROD 1007/1027, PRE 253, TEST 1461) render N from turn.points and ¥ from credits / creditsPerCny", async () => {
  const fixtures = JSON.parse(readFileSync(new URL("./fixtures/settlement-shells.json", import.meta.url), "utf8"));
  const shown = async (key: string) => { const raw = fixtures[key]; return text(await read(raw), raw.data.data.turns[0].stepId); };
  assert.equal(await shown("PROD-1007"), "3 贝壳（≈¥0.0057）", "17 credits over three calls: Core's 3, never ceil(17/3000*100)=1");
  assert.equal(await shown("PROD-1027"), "1 贝壳（≈¥0.0023）");
  assert.equal(await shown("PRE-253"), "131 贝壳（≈¥1.2933）");
  assert.equal(await shown("TEST-1461"), "0 贝壳");
});

test("unit name and rate come only from the contract: another name or rate changes the text (nothing hard-coded)", async () => {
  assert.equal(text(await read(answer({ pointsName: { "zh-CN": "海贝", en: "Shell" } }, turn()))), "1 海贝（≈¥0.0010）");
  assert.equal(text(await read(answer({ creditsPerCny: 6000, rate: { creditsAmount: 6000, coinAmount: 100 } }, turn({ credits: "12", points: "1" })))),
    "1 贝壳（≈¥0.0020）");
  // The island's locale picks the contract's name; the prop is the only new input of <TurnUsage>.
  const en = renderToString(React.createElement(TurnUsage, { t: (k: string) => k, usage: turnUsage(scope, await read(answer({}, turn()))), locale: "en" } as never));
  assert.match(en, /Seashell/);
  assert.doesNotMatch(en, /贝壳/);
  for (const file of ["src/chat-react/turnUsage.ts", "src/chat-react/TurnUsage.tsx", "src/addons/conversation/api/settlement.ts"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/\/\/.*$|\/\*[^]*?\*\//gm, "");
    assert.doesNotMatch(source, /\b3000\b|\b100\b|贝壳|Seashell/, `${file} writes no rate or unit name of its own`);
  }
});

test("no rate, no creditsPerCny, no pointsName or no turn points: N 积分 (credits), never ¥", async () => {
  for (const top of [{ rate: null }, { rate: undefined }, { creditsPerCny: null }, { creditsPerCny: undefined }, { pointsName: null }, { pointsName: undefined },
    { creditsPerCny: 0 }, { creditsPerCny: -3000 }, { creditsPerCny: "3000" }, { creditsPerCny: 1.5 }, { rate: { creditsAmount: 0, coinAmount: 100 } },
    { pointsName: { en: "Seashell" } }, { pointsName: { "zh-CN": "" } }]) {
    assert.equal(text(await read(answer(top, turn({ credits: "7" })))), "7 积分", JSON.stringify(top));
  }
  for (const points of [null, undefined]) {
    assert.equal(text(await read(answer({}, turn({ credits: "7", points })))), "7 积分", String(points));
  }
  assert.equal(text(await read(answer({ rate: null }, turn({ credits: "0", points: null })))), "0 积分", "a settled zero without rate is still 0, without ¥");
  assert.equal(text(await read(answer({ rate: null }, turn({ credits: "0", points: "0" })))), "0 积分", "no rate: the old unit even for a free turn");
});

test("an old Core without any of the new fields still reads, shows N 积分 and never throws or shows ¥", async () => {
  const old = { data: { code: 0, data: { unit: "credits", revision: 1000, turns: [{ ...turn({ credits: "7" }), points: undefined }] } } };
  const rows = await read(old);
  assert.equal(rows.length, 1);
  assert.equal(text(rows), "7 积分");
});

// exp106: unknown (and no evidence yet) shows 计费中, never 0 and never ¥ (replaces exp103's "—").
test("pending shows 待结算 with no number and no ¥; unknown shows 计费中 with no number and no ¥", async () => {
  const rows = await read(answer({}, turn({ stepId: "turn-p", state: "pending", credits: null, points: null }),
    turn({ stepId: "turn-u", state: "unknown", credits: null, points: null })));
  const pending = text(rows, "turn-p");
  assert.match(pending, /待结算/);
  assert.doesNotMatch(pending, /\d|¥|贝壳（/);
  const unknown = text(rows, "turn-u");
  assert.equal(unknown, "计费中");
  assert.equal(text(rows, "turn-none"), "计费中");
  assert.equal(pending, "待结算");
  assert.equal(text(await read(new Error("ledger down"))), "计费中", "a failed read is not 0 and not ¥");
});

test("contract check: points is a whole-number string and only on settled turns; anything else voids the read, never a number", async () => {
  const good = turn({ stepId: "turn-d", credits: "3", points: "1" });
  for (const broken of [
    answer({}, good, turn({ state: "pending", credits: null, points: "0" })), answer({}, good, turn({ state: "unknown", credits: null, points: "1" })),
    answer({}, good, turn({ points: "1.5" })), answer({}, good, turn({ points: "-1" })), answer({}, good, turn({ points: "01" })),
    answer({}, good, turn({ points: "" })), answer({}, good, turn({ points: 1 })), answer({}, good, turn({ points: "1e3" })),
  ]) {
    assert.deepEqual(await read(broken), [], JSON.stringify(broken));
  }
  // The good turn alone, with the same top-level fields, reads.
  assert.equal(text(await read(answer({}, good)), "turn-d"), "1 贝壳（≈¥0.0010）");
});

test("no 上游 anywhere on the usage line", async () => {
  for (const shown of [text(await read(answer({}, turn()))), text(await read(answer({ rate: null }, turn())))]) {
    assert.doesNotMatch(shown, /上游|aihub-gateway|everai-yunyi/);
  }
});
