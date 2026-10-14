// UI-IMPL-6H: the home composer generates image AND video inside a new chat.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createGenChat, HOME_CONFIRM_KEY } from "../src/addons/conversation/composables/homeGen.ts";

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const model = { kind: "video", providerId: "p1", model: "v-1" } as never;

function deps(confirmAnswer: boolean, store: Record<string, string> = {}) {
  const calls = { create: [] as unknown[], push: [] as unknown[], confirm: 0 };
  return {
    calls,
    d: {
      create: async (body: unknown) => { calls.create.push(body); return { conversationId: 42 }; },
      push: async (to: unknown) => { calls.push.push(to); },
      confirm: async () => { calls.confirm++; return confirmAnswer; },
      ls: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } },
    },
  };
}

test("H1 video: confirm, create in a new chat (conversationId 0) with video params, open /c/<id>?gen=video", async () => {
  const { calls, d } = deps(true);
  const ok = await createGenChat(d, "video", model, "a cat", { aspect: "9:16", duration: "8", resolution: "720p", count: "1" });
  assert.equal(ok, true);
  assert.equal(calls.confirm, 1);
  assert.deepEqual(calls.create, [{ kind: "video", providerId: "p1", model: "v-1", prompt: "a cat", conversationId: 0,
    aspect: "9:16", duration: 8, resolution: "720p", count: 1 }]);
  assert.deepEqual(calls.push, [{ path: "/c/42", query: { gen: "video" } }]);
});

test("H2 video cancel: no chat, no generation, no navigation", async () => {
  const { calls, d } = deps(false);
  assert.equal(await createGenChat(d, "video", model, "a cat", { aspect: "16:9", duration: "4", resolution: "480p", count: "1" }), false);
  assert.equal(calls.create.length, 0);
  assert.equal(calls.push.length, 0);
});

test("H3 video 'don't remind me' on home skips the dialog next time", async () => {
  const { calls, d } = deps(true, { ["chatGen.videoConfirmSkip:" + HOME_CONFIRM_KEY]: "1" });
  await createGenChat(d, "video", model, "x", { aspect: "16:9", duration: "4", resolution: "480p", count: "1" });
  assert.equal(calls.confirm, 0);
  assert.equal(calls.create.length, 1);
});

test("H4 image path unchanged: no confirm, body { aspect, count }, gen=image", async () => {
  const { calls, d } = deps(false);
  const img = { kind: "image", providerId: "p2", model: "i-1" } as never;
  assert.equal(await createGenChat(d, "image", img, "sun", { aspect: "3:4", count: "3" }), true);
  assert.equal(calls.confirm, 0);
  assert.deepEqual(calls.create, [{ kind: "image", providerId: "p2", model: "i-1", prompt: "sun", conversationId: 0, aspect: "3:4", count: 3 }]);
  assert.deepEqual(calls.push, [{ path: "/c/42", query: { gen: "image" } }]);
});

test("H5 Home.vue: ＋ menu not restricted to image, kind is bound, no jump to the generate page", () => {
  const home = src("addons/conversation/views/Home.vue");
  assert.doesNotMatch(home, /only="image"/);
  assert.equal((home.match(/<ChatGenBar[^>]*v-model:kind="genKind"/g) ?? []).length, 2);
  assert.doesNotMatch(home, /name:\s*"generate"/);
  assert.match(home, /createGenChat\(/);
  assert.match(home, /<VideoConfirm/);
  assert.match(home, /route\.query\.gen === "video"/);
});

test("H6 ChatGenBar `only` still filters for other callers; Conversation still accepts gen=video", () => {
  assert.match(src("addons/conversation/components/media/ChatGenBar.vue"), /!props\.only \|\| k\.kind === props\.only/);
  const conv = src("addons/conversation/views/Conversation.vue");
  assert.match(conv, /route\.query\.gen === "video" \? "video" : "image"/);
  assert.match(conv, /:only="carrier \? 'image' : undefined"/);
});
