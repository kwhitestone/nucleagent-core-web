import assert from "node:assert/strict";
import { test } from "node:test";

import { createConversationListController } from "../src/addons/administration/views/admin/conversationListController.ts";

// MUYU-163 review finding 4: only the latest query may commit rows and cursors.
// Constructed rows only.

type Deferred = { params: { type: string; userId?: string; cursor: string }; resolve: (page: any) => void; reject: (error: unknown) => void };

function harness() {
  const pending: Deferred[] = [];
  const errors: unknown[] = [];
  const fetchPage = (filters: any, cursor: string) => new Promise<any>((resolve, reject) => {
    pending.push({ params: { type: filters.type, userId: filters.userId, cursor }, resolve, reject });
  });
  const list = createConversationListController(fetchPage, 2, (error) => errors.push(error));
  return { list, pending, errors };
}

const chatRow = (id: number) => ({ type: "chat", id, userId: 1, processing: false });
const imRow = (id: number) => ({ type: "im", id, userId: 2, processing: false });

test("a slow chat response arriving after a newer IM response does not overwrite the IM rows or cursor", async () => {
  const { list, pending } = harness();
  const chat = list.search();
  const im = list.switchType("im");
  assert.equal(pending.length, 2);
  pending[1].resolve({ items: [imRow(9)], nextCursor: "im-c2", hasMore: true });
  await im;
  pending[0].resolve({ items: [chatRow(7)], nextCursor: "chat-c2", hasMore: true });
  await chat;
  assert.equal(list.state.filters.type, "im");
  assert.deepEqual(list.state.rows.map((r) => `${r.type}-${r.id}`), ["im-9"]);
  assert.equal(list.state.nextCursor, "im-c2");
  assert.deepEqual(list.state.cursors, ["", "im-c2"]);
  assert.equal(list.state.loading, false);
  // The next page carries the IM cursor, never the chat one.
  void list.load(1);
  assert.deepEqual(pending[2].params, { type: "im", userId: "", cursor: "im-c2" });
});

test("a slower older search for another user is discarded; the newest keeps loading until it lands", async () => {
  const { list, pending } = harness();
  list.state.filters.userId = "11";
  const first = list.search();
  list.state.filters.userId = "12";
  const second = list.search();
  pending[0].resolve({ items: [chatRow(1)], nextCursor: "", hasMore: false });
  await first;
  assert.deepEqual(list.state.rows, []);
  assert.equal(list.state.loading, true, "the newer query is still in flight");
  pending[1].resolve({ items: [chatRow(2)], nextCursor: "", hasMore: false });
  await second;
  assert.deepEqual(list.state.rows.map((r) => r.id), [2]);
  assert.equal(list.state.loading, false);
});

test("a stale failure is silent and a stale next-page response is dropped after a new search", async () => {
  const { list, pending, errors } = harness();
  const first = list.search();
  pending[0].resolve({ items: [chatRow(5), chatRow(4)], nextCursor: "c2", hasMore: true });
  await first;
  const nextPage = list.load(1);
  const fresh = list.search();
  pending[1].reject(new Error("stale failure"));
  pending[2].resolve({ items: [chatRow(9)], nextCursor: "", hasMore: false });
  await Promise.all([nextPage, fresh]);
  assert.deepEqual(errors, []);
  assert.deepEqual(list.state.rows.map((r) => r.id), [9]);
  assert.equal(list.state.pageIndex, 0);
  assert.deepEqual(list.state.cursors, [""]);
  // A current failure is still reported.
  const failing = list.search();
  pending[3].reject(new Error("current failure"));
  await failing;
  assert.equal(errors.length, 1);
});

test("leaving the page drops the in-flight answer; re-selecting the current type sends nothing", async () => {
  const { list, pending, errors } = harness();
  await list.switchType("chat");
  assert.equal(pending.length, 0);
  const inFlight = list.search();
  list.dispose();
  pending[0].reject(new Error("after unmount"));
  await inFlight;
  assert.deepEqual(errors, []);
  assert.deepEqual(list.state.rows, []);
});

// Review 01a17ae4 (P2): a new filter whose request fails must not leave the
// previous filter's rows, page number or cursors on screen.
async function onSecondChatPage(h: ReturnType<typeof harness>) {
  const first = h.list.search();
  h.pending.at(-1)!.resolve({ items: [chatRow(9), chatRow(8)], nextCursor: "chat2", hasMore: true });
  await first;
  const second = h.list.load(1);
  h.pending.at(-1)!.resolve({ items: [chatRow(7), chatRow(6)], nextCursor: "chat3", hasMore: true });
  await second;
  assert.equal(h.list.state.pageIndex, 1);
  assert.equal(h.list.state.nextCursor, "chat3");
}

function assertEmptyFirstPage(list: any) {
  assert.deepEqual(list.state.rows, []);
  assert.equal(list.state.pageIndex, 0);
  assert.equal(list.state.nextCursor, "");
  assert.deepEqual(list.state.cursors, [""]);
  assert.equal(list.state.loading, false);
}

test("chat page 2, switch to IM, the IM request fails: no chat rows, no page 2, no chat cursor", async () => {
  const h = harness();
  await onSecondChatPage(h);
  const im = h.list.switchType("im");
  // While the IM request is in flight nothing of the chat walk is shown either.
  assert.deepEqual(h.list.state.rows, []);
  assert.equal(h.list.state.pageIndex, 0);
  assert.equal(h.list.state.nextCursor, "");
  h.pending.at(-1)!.reject(new Error("503"));
  await im;
  assert.equal(h.list.state.filters.type, "im");
  assertEmptyFirstPage(h.list);
  assert.equal(h.errors.length, 1);
  // Retrying asks for IM page 1 with no cursor and lands on page 1.
  const retry = h.list.search();
  assert.deepEqual(h.pending.at(-1)!.params, { type: "im", userId: "", cursor: "" });
  h.pending.at(-1)!.resolve({ items: [imRow(3)], nextCursor: "", hasMore: false });
  await retry;
  assert.equal(h.list.state.pageIndex, 0);
  assert.deepEqual(h.list.state.rows.map((r) => `${r.type}-${r.id}`), ["im-3"]);
});

test("results for user 11 on page 2, search user 12, that request fails: user 11's rows are gone", async () => {
  const h = harness();
  h.list.state.filters.userId = "11";
  await onSecondChatPage(h);
  h.list.state.filters.userId = "12";
  const search = h.list.search();
  h.pending.at(-1)!.reject(new Error("502"));
  await search;
  assert.equal(h.list.state.filters.userId, "12");
  assertEmptyFirstPage(h.list);
  assert.equal(h.errors.length, 1);
});

test("a failed next page keeps the page that is shown, consistent with its own cursor", async () => {
  const h = harness();
  await onSecondChatPage(h);
  const third = h.list.load(2);
  h.pending.at(-1)!.reject(new Error("503"));
  await third;
  assert.deepEqual(h.list.state.rows.map((r) => r.id), [7, 6]);
  assert.equal(h.list.state.pageIndex, 1);
  assert.equal(h.list.state.nextCursor, "chat3");
  assert.deepEqual(h.list.state.cursors, ["", "chat2", "chat3"]);
  assert.equal(h.errors.length, 1);
});
