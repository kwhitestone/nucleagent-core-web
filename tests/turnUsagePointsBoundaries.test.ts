import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { settlementRows, turnUsage } from "../src/chat-react/turnUsage.ts";
import { readSettlement } from "../src/addons/conversation/api/settlement.ts";
import { registerPlatformRuntime } from "../src/contracts/platform-runtime.ts";
import { ZH_STRINGS } from "../src/chat-react/islandStringsZh.ts";

// MUYU-365 exp116 boundaries (after GREEN): each of the three fields is checked on its own; the real Core answers of
// PROD 1007/1027 with the v0.1.80 fields (ok) and with all three null (old Core) render exactly the exp106 text.

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
const NAME = { "zh-CN": "贝壳", en: "Seashell" };
const turn = (over: object = {}) => ({ stepId: "turn-a", state: "settled", credits: "17", points: "3", upstreams: ["u"], callIds: ["1"], logicalRequestIds: ["lr-1"], keyIds: ["k"], revision: 1000, ...over });
const answer = (top: object, ...turns: unknown[]) => ({ data: { code: 0, data: { unit: "credits", revision: 1000, pointsName: NAME, creditsPerCny: 3000,
  rate: { creditsAmount: 3000, coinAmount: 100 }, turns, ...top } } });
async function read(raw: unknown) {
  const off = registerPlatformRuntime({ http: { get: async () => raw } } as never);
  try { return settlementRows(await readSettlement("7", new AbortController().signal).catch((error: unknown) => error)); } finally { off(); }
}
const html = (rows: Parameters<typeof turnUsage>[1], turnId = "turn-a") =>
  renderToString(React.createElement(TurnUsage, { t: zh, usage: turnUsage({ conversationId: "7", turnId }, rows) }));
const text = (rows: Parameters<typeof turnUsage>[1], turnId = "turn-a") => html(rows, turnId).replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "");
const title = (rows: Parameters<typeof turnUsage>[1]) => /title="([^"]*)"/.exec(html(rows))?.[1] ?? "";

test("old Core (all three null) and v0.1.80 ok on the PROD 1007/1027 shapes: exactly the exp106 text", async () => {
  for (const top of [{}, { pointsStatus: null, pointsReason: null, rateAgeSeconds: null }, { pointsStatus: "ok", pointsReason: null, rateAgeSeconds: null }]) {
    assert.equal(text(await read(answer(top, turn()))), "3 贝壳（≈¥0.0057）", JSON.stringify(top));
    assert.equal(text(await read(answer(top, turn({ credits: "7", points: "1" })))), "1 贝壳（≈¥0.0023）", JSON.stringify(top));
    assert.doesNotMatch(html(await read(answer(top, turn()))), /<small/, "no note on ok / old Core");
  }
});

test("each field is checked alone: a bad reason or age never hides a valid status", async () => {
  // stale + garbage reason: note stays, title falls back to the note itself
  const rows = await read(answer({ pointsStatus: "stale", pointsReason: 42, rateAgeSeconds: 8 }, turn()));
  assert.equal(text(rows), "3 贝壳（≈¥0.0057） · 汇率 8 秒前");
  assert.equal(title(rows), "汇率 8 秒前");
  // ok + a stray age / reason: still no note
  assert.equal(text(await read(answer({ pointsStatus: "ok", pointsReason: "rate_expired", rateAgeSeconds: 99 }, turn()))), "3 贝壳（≈¥0.0057）");
  // unavailable + an age (only stale has one): the age is ignored
  assert.equal(text(await read(answer({ rate: null, pointsStatus: "unavailable", pointsReason: "rate_expired", rateAgeSeconds: 99 }, turn({ credits: "7", points: null })))), "7 积分 · 汇率暂不可用");
  // a huge but safe age still prints as an integer
  assert.equal(text(await read(answer({ pointsStatus: "stale", rateAgeSeconds: 86400 }, turn()))), "3 贝壳（≈¥0.0057） · 汇率 86400 秒前");
});

test("a well-formed but unknown reason that collides with an object key is still the generic hint", async () => {
  for (const reason of ["constructor", "prototype", "rate_", "valueof"]) {
    const rows = await read(answer({ rate: null, pointsStatus: "unavailable", pointsReason: reason }, turn({ credits: "7", points: null })));
    assert.equal(title(rows), "汇率暂不可用", reason);
    assert.equal(text(rows), "7 积分 · 汇率暂不可用", reason);
  }
});

test("stale while Core sent no usable rate contradicts the contract: no stale note, the plain old N 积分", async () => {
  assert.equal(text(await read(answer({ rate: null, pointsStatus: "stale", pointsReason: "rate_refresh_failed", rateAgeSeconds: 3 }, turn({ credits: "7", points: null })))), "7 积分");
});

test("pending turns next to a stale/unavailable settled turn: the settled one carries the note, the pending one never", async () => {
  const rows = await read(answer({ rate: null, pointsStatus: "unavailable", pointsReason: "rate_never_fetched" },
    turn({ credits: "7", points: null }), turn({ stepId: "turn-p", state: "pending", credits: null, points: null })));
  assert.equal(text(rows), "7 积分 · 汇率暂不可用");
  assert.equal(text(rows, "turn-p"), "待结算");
  assert.equal(title(rows), "尚未取到汇率");
});
