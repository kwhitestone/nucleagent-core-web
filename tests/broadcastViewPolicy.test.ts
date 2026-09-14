import assert from "node:assert/strict";
import test from "node:test";
import {
  broadcastGroupId,
  broadcastRoute,
  activeBroadcastMember,
  broadcastBackendSelection,
  activeSidebarConversation,
} from "../src/addons/conversation/composables/broadcastViewPolicy.ts";

const groupId = "371879a2-c7a5-43b5-92a3-3e9dc30c0989";

test("only a UUID group in structured state redirects a conversation", () => {
  assert.equal(broadcastGroupId({ state: { broadcastGroupId: groupId } }), groupId);
  for (const state of [undefined, null, "json", [], {}, { broadcastGroupId: "../admin" }, { broadcastGroupId: 41 }]) {
    assert.equal(broadcastGroupId({ state }), undefined);
  }
  assert.deepEqual(broadcastRoute({ id: 41, state: { broadcastGroupId: groupId } }), {
    path: `/b/${groupId}`, query: { conversationId: "41" },
  });
  assert.equal(broadcastRoute({ id: 41 }), undefined);
});

test("tab selection only accepts members and falls back after a member is removed", () => {
  const members = [{ id: 41 }, { id: 42 }];
  assert.equal(activeBroadcastMember(members, "42"), 42);
  for (const query of ["99", "-1", "41oops", ["42"], undefined]) {
    assert.equal(activeBroadcastMember(members, query), 41);
  }
  assert.equal(activeBroadcastMember([], "42"), null);
});

test("backend count reuses protocol compatibility and deduplicates candidates", () => {
  const option = (id: string, extra = {}) => ({
    id, displayName: id, type: id, streaming: true, default: false, ...extra,
  });
  const options = [option("codex"), option("codex"), option("opencode"), option("gemini-cli")];
  assert.deepEqual(broadcastBackendSelection(options, null, []), {
    eligible: ["codex"],
    skipped: [{ backend: "opencode", reason: "model_required" }, { backend: "gemini-cli", reason: "model_required" }],
  });
  const providers = [{ id: 2, name: "OpenAI", isActive: true, config: { apiFormat: "openai" } }];
  assert.deepEqual(broadcastBackendSelection(options, { providerId: 2, model: "model-a" }, providers), {
    eligible: ["codex", "opencode"],
    skipped: [{ backend: "gemini-cli", reason: "protocol_incompatible" }],
  });
  assert.deepEqual(broadcastBackendSelection([], null, []), { eligible: [], skipped: [] });
});

test("sidebar uses the selected group member and never an unrelated query id", () => {
  const rows = [{ id: 41, state: { broadcastGroupId: groupId } }, { id: 42, state: { broadcastGroupId: groupId } }, { id: 99 }];
  assert.equal(activeSidebarConversation(`/b/${groupId}`, "42", rows), 42);
  assert.equal(activeSidebarConversation(`/b/${groupId}`, "99", rows), 41);
  assert.equal(activeSidebarConversation("/c/99", undefined, rows), 99);
  assert.equal(activeSidebarConversation("/creation", undefined, rows), null);
  assert.equal(activeSidebarConversation(`/b/${groupId}`, "42", []), null);
});
