import assert from "node:assert/strict";
import { test } from "node:test";
import { settlementRows, turnUsage, type SettlementEvidence } from "../src/chat-react/turnUsage.ts";
import { readSettlement } from "../src/addons/conversation/api/settlement.ts";
import { registerPlatformRuntime } from "../src/contracts/platform-runtime.ts";

const scope = { conversationId: "7", turnId: "turn-a" };
const settled = (over: Partial<SettlementEvidence> = {}): SettlementEvidence => ({
  ...scope, state: "settled", points: "0", upstreams: ["aihub-gateway"], revision: 1, ...over,
});

test("only authoritative settled decimal strings show true zero or positive points", () => {
  assert.deepEqual(turnUsage(scope, [settled()]), { state: "settled", points: "0", upstreams: ["aihub-gateway"] });
  assert.equal(turnUsage(scope, [settled({ points: "1.25" })]).points, "1.25");
  for (const points of [undefined, null, 0, -1, "", "-1", "NaN", "Infinity", "1e3", " 0"]) {
    assert.equal(turnUsage(scope, [settled({ points })]).points, "—");
  }
});

test("UNKNOWN, pending, missing authority and incomplete upstream evidence never become zero", () => {
  assert.deepEqual(turnUsage(scope), { state: "unknown", points: "—", upstreams: [] });
  for (const evidence of [settled({ state: "unknown" }), settled({ state: "pending" }), settled({ upstreams: [] }), settled({ upstreams: [""] })]) {
    assert.equal(turnUsage(scope, [evidence]).points, "—");
  }
});

test("pending settlement is its own state, never zero, and yields to a later settled or UNKNOWN revision", () => {
  const pending = settled({ state: "pending", points: "0", upstreams: [] });
  assert.deepEqual(turnUsage(scope, [pending]), { state: "pending", points: "—", upstreams: [] });
  assert.equal(turnUsage(scope, [settled({ revision: 0 }), pending]).state, "pending");
  assert.deepEqual(turnUsage(scope, [pending, settled({ revision: 2 })]), { state: "settled", points: "0", upstreams: ["aihub-gateway"] });
  assert.equal(turnUsage(scope, [pending, settled({ revision: 2, state: "unknown" })]).state, "unknown");
  assert.equal(turnUsage(scope, [pending, { ...pending }]).state, "unknown");
  assert.equal(turnUsage({ ...scope, turnId: "turn-b" }, [pending]).state, "unknown");
});

test("mixed upstreams stay bound to the matching conversation and turn", () => {
  const evidence = settled({ points: "2", upstreams: ["aihub-gateway", "everai-yunyi"] });
  assert.deepEqual(turnUsage(scope, [evidence]).upstreams, ["aihub-gateway", "everai-yunyi"]);
  assert.equal(turnUsage({ ...scope, turnId: "turn-b" }, [evidence]).points, "—");
  assert.equal(turnUsage({ ...scope, conversationId: "8" }, [evidence]).points, "—");
});

test("late settlement, refresh and newer UNKNOWN revisions replace stale totals without summing", () => {
  const pending = settled({ state: "pending" });
  const late = settled({ revision: 2, points: "0.75" });
  assert.equal(turnUsage(scope, [pending]).points, "—");
  assert.equal(turnUsage(scope, [late, pending]).points, "0.75");
  assert.deepEqual(turnUsage(scope, JSON.parse(JSON.stringify([pending, late]))), turnUsage(scope, [late]));
  assert.equal(turnUsage(scope, [late, settled({ revision: 3, state: "unknown" })]).points, "—");
  assert.equal(turnUsage(scope, [late, { ...late, points: "9" }]).points, "—");
});

test("a reader result with any malformed row is dropped whole, so a broken newest revision cannot be skipped", () => {
  const rows = [settled(), settled({ revision: 2, points: "3" })];
  assert.equal(settlementRows(rows), rows);
  for (const raw of [undefined, null, {}, "[]", [null], [...rows, { ...settled({ revision: 3 }), upstreams: undefined }],
    [{ ...settled(), turnId: 7 }], [{ ...settled(), conversationId: 7 }], [{ ...settled(), revision: "2" }]]) {
    assert.deepEqual(settlementRows(raw), []);
  }
  assert.equal(turnUsage(scope, settlementRows([{ ...settled(), state: "done" }])).points, "—");
});

test("Core reader: the owner route's turns become evidence by step id; anything off the contract voids the read or leaves its turn unknown, never a number", async () => {
  const turn = (over: object = {}) => ({ stepId: "turn-a", state: "settled", credits: "7", upstreams: ["alpha", "beta"], callIds: ["1", "2"],
    logicalRequestIds: ["lr-1", "lr-2"], keyIds: ["10"], revision: 1000, ...over });
  const good = turn({ stepId: "turn-d", credits: "3" });
  const answer = (over: object = {}, ...turns: unknown[]) => ({ data: { code: 0, data: { unit: "credits", revision: 1000, turns, ...over } } });
  let reply: unknown = answer({}, turn(), turn({ stepId: "turn-b", state: "pending", credits: null, upstreams: [] }),
    turn({ stepId: "turn-c", state: "unknown", credits: null }), turn({ stepId: "turn-d", credits: "0" }));
  const calls: unknown[] = [];
  const off = registerPlatformRuntime({ http: { get: async (...args: unknown[]) => { calls.push(args); if (reply instanceof Error) throw reply; return reply; } } } as never);
  try {
    const signal = new AbortController().signal;
    const rows = await readSettlement("7/../8", signal);
    assert.deepEqual(calls, [["/api/v1/addons/conversation/7%2F..%2F8/settlement", { signal }]]);
    assert.equal(turnUsage({ conversationId: "7/../8", turnId: "turn-a" }, rows).points, "7");
    const read = await readSettlement("7", signal);
    assert.deepEqual(read[0], { ...turn(), conversationId: "7", turnId: "turn-a", points: "7" });
    assert.equal(settlementRows(read), read);
    assert.deepEqual(["turn-a", "turn-b", "turn-c", "turn-d", "turn-e"].map((turnId) => turnUsage({ ...scope, turnId }, read).state + turnUsage({ ...scope, turnId }, read).points),
      ["settled7", "pending—", "unknown—", "settled0", "unknown—"]);
    reply = answer({});
    assert.deepEqual(await readSettlement("7", signal), [], "a conversation older than the bindings has no turns: all unknown");
    // Off the contract: the read rejects or is voided whole (the hook then shows nothing), so not even the good turn beside it shows.
    for (const broken of [
      { data: {} }, { data: { data: null } }, {}, answer({ unit: "quota" }, good), answer({ unit: undefined }, good), answer({ turns: {} }), answer({ turns: null }),
      answer({}, good, null), answer({}, good, turn({ stepId: 7 })), answer({}, good, turn({ stepId: undefined })), answer({}, good, turn({ credits: null })),
      answer({}, good, turn({ credits: "1.5" })), answer({}, good, turn({ credits: "-1" })), answer({}, good, turn({ credits: "1e3" })), answer({}, good, turn({ credits: "" })),
      answer({}, good, turn({ credits: undefined })), answer({}, good, turn({ state: "pending" })), answer({}, good, turn({ state: "pending", credits: undefined })),
      answer({}, good, turn({ state: "unknown", credits: "0" })), answer({}, good, turn({ state: "done" })), answer({}, good, turn({ upstreams: undefined })),
      answer({}, good, turn({ upstreams: "alpha" })), answer({}, good, turn({ revision: "1000" })), answer({}, good, turn({ revision: undefined })),
    ]) {
      reply = broken;
      assert.deepEqual(settlementRows(await readSettlement("7", signal).catch((error: unknown) => error)), [], JSON.stringify(broken));
    }
    // A turn whose own values are off stays unknown and never borrows a number; the turns beside it still read.
    for (const wrong of [{ credits: 7 }, { credits: "07" }, { stepId: "" }, { upstreams: [7] }, { upstreams: [] }, { revision: 1.5 }, { revision: -1 }, { state: "done", credits: null }]) {
      reply = answer({}, turn(wrong), good);
      const shown = settlementRows(await readSettlement("7", signal));
      assert.deepEqual([turnUsage(scope, shown).points, turnUsage({ ...scope, turnId: "turn-d" }, shown).points], ["—", "3"], JSON.stringify(wrong));
    }
    reply = Object.assign(new Error("ledger down"), { status: 503 });
    await assert.rejects(readSettlement("7", signal), /ledger down/);
  } finally {
    off();
  }
});
