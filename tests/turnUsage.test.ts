import assert from "node:assert/strict";
import { test } from "node:test";
import { turnUsage, type SettlementEvidence } from "../src/chat-react/turnUsage.ts";

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
