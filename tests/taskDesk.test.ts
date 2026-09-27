import assert from "node:assert/strict";
import test from "node:test";
import { deskOrder, relativeTime } from "../src/addons/conversation/composables/taskDesk.ts";
import { clearDraft, readDraft, saveDraft, DRAFT_KEY } from "../src/addons/conversation/composables/taskDraft.ts";

const row = (id: number, status: string, createdAt: string) => ({ id, status, createdAt }) as never;

test("task desk: needs-you first, then running, then the rest newest first", () => {
  const ordered = deskOrder([
    row(1, "completed", "2026-09-27T10:00:00Z"),
    row(2, "executing", "2026-09-27T08:00:00Z"),
    row(3, "blocked", "2026-09-26T08:00:00Z"),
    row(4, "failed", "2026-09-27T11:00:00Z"),
    row(5, "blocked", "2026-09-27T09:00:00Z"),
  ]).map((c: { id: number }) => c.id);
  assert.deepEqual(ordered, [5, 3, 2, 4, 1]);
});

test("relative time: seconds → now, minutes, hours, days, then a date", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  assert.equal(relativeTime("2026-09-28T11:59:40Z", now, "en"), "now");
  assert.equal(relativeTime("2026-09-28T11:57:00Z", now, "en"), "3 minutes ago");
  assert.equal(relativeTime("2026-09-28T09:00:00Z", now, "en"), "3 hours ago");
  assert.equal(relativeTime("2026-09-27T12:00:00Z", now, "en"), "yesterday");
  assert.match(relativeTime("2026-09-01T12:00:00Z", now, "en"), /2026/);
  assert.equal(relativeTime("not a date", now, "en"), "");
});

class MemoryStorage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(k: string) { return this.values.get(k) ?? null; }
  key(i: number) { return [...this.values.keys()][i] ?? null; }
  removeItem(k: string) { this.values.delete(k); }
  setItem(k: string, v: string) { this.values.set(k, v); }
}

test("Q5 draft: round-trips, clears, and rejects junk instead of half-filling the form", () => {
  const storage = new MemoryStorage() as unknown as Storage;
  assert.equal(readDraft(storage), null);
  const draft = { name: "竞品分析", desc: "AI Agent 市场", execMode: "auto", outputFormat: "pdf", templateName: "研究", skillIds: [3, 5] };
  saveDraft(storage, draft);
  assert.deepEqual(readDraft(storage), draft);
  clearDraft(storage);
  assert.equal(readDraft(storage), null);
  for (const junk of ["{", "[]", "null", '{"name":""}', '{"name":1,"desc":{}}']) {
    storage.setItem(DRAFT_KEY, junk);
    assert.equal(readDraft(storage), null, junk);
  }
  storage.setItem(DRAFT_KEY, JSON.stringify({ name: "x", skillIds: [1, -2, "3", 4.5] }));
  assert.deepEqual(readDraft(storage), { name: "x", desc: "", execMode: "auto", outputFormat: "markdown", templateName: "", skillIds: [1] });
});
