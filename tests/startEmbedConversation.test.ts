import assert from "node:assert/strict";
import test from "node:test";
import { startEmbedConversation, type EmbedConversationDeps } from "../src/composables/startEmbedConversation.ts";

function fixture() {
  const calls: { create: unknown[]; generate: unknown[]; routes: unknown[] } = { create: [], generate: [], routes: [] };
  const deps: EmbedConversationDeps = {
    create: async (body) => { calls.create.push(body); return { id: 42 }; },
    models: async (kind) => [
      { kind, providerId: 1, model: "first", verified: false },
      { kind, providerId: 2, model: "default", verified: true },
    ],
    generate: async (body) => { calls.generate.push(body); return { conversationId: 43 }; },
    push: async (to) => { calls.routes.push(to); },
  };
  return { deps, calls };
}

test("text creates an ordinary agent conversation and navigates", async () => {
  const { deps, calls } = fixture();
  assert.equal(await startEmbedConversation(deps, { input: "hello" }), "42");
  assert.deepEqual(calls.create, [{ mode: "a2a_agent", input: "hello" }]);
  assert.deepEqual(calls.generate, []);
  assert.deepEqual(calls.routes, [{ path: "/c/42" }]);
});

for (const gen of ["image", "video"] as const) {
  test(`${gen} uses the default media model and existing generation flow`, async () => {
    const { deps, calls } = fixture();
    assert.equal(await startEmbedConversation(deps, { input: "hello", gen }), "43");
    assert.deepEqual(calls.create, []);
    assert.equal(calls.generate.length, 1);
    assert.equal((calls.generate[0] as { model: string }).model, "default");
    assert.equal((calls.generate[0] as { kind: string }).kind, gen);
    assert.equal((calls.generate[0] as { conversationId: number }).conversationId, 0);
    assert.deepEqual(calls.routes, [{ path: "/c/43", query: { gen } }]);
  });
}

test("missing models and malformed creation results do not navigate or retry", async () => {
  const { deps, calls } = fixture();
  deps.models = async () => [];
  await assert.rejects(startEmbedConversation(deps, { input: "hello", gen: "image" }));
  assert.deepEqual(calls.generate, []);
  deps.create = async () => ({ id: NaN });
  await assert.rejects(startEmbedConversation(deps, { input: "hello" }));
  assert.deepEqual(calls.routes, []);
});

test("revocation while loading media models prevents generation", async () => {
  const { deps, calls } = fixture();
  const controller = new AbortController();
  const models = deps.models;
  deps.models = async (kind) => { controller.abort(); return models(kind); };
  await assert.rejects(startEmbedConversation(deps, { input: "hello", gen: "image" }, controller.signal));
  assert.deepEqual(calls.generate, []);
  assert.deepEqual(calls.routes, []);
});
