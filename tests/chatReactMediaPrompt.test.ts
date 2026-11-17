import assert from "node:assert/strict";
import { test } from "node:test";
import { directMediaRequest, directMediaTool } from "../src/chat-react/workflowParams.ts";

// MUYU-365 exp4: Core projects an imported Toolgate job tool with the source's own prompt
// parameter name (e.g. seedream 684: required ["prompt"], no "input"). The composer text is that prompt.
const seedream = { model: "doubao-seedream-5-0-260128", invocation: { toolId: 684, revision: "8" },
  inputSchema: { type: "object", additionalProperties: false, required: ["prompt"],
    properties: { prompt: { type: "string" }, aspect_ratio: { type: "string" }, quality: { type: "string" }, prompts: { type: "array" } } } };
const rows = [{ id: 684, imported: true, status: "ready", mediaModel: "doubao-seedream-5-0-260128" }];

test("a job tool whose only free-text required parameter is `prompt` takes the composer text as that prompt", async () => {
  const direct = await directMediaTool("doubao-seedream-5-0-260128", rows, async () => seedream);
  assert.equal(direct?.toolId, 684);
  assert.equal(direct?.prompt, "prompt");
  assert.deepEqual(directMediaRequest(direct!, { quality: "" }, "一只猫"),
    { toolIds: [684], toolInvocation: { toolId: 684, revision: "8", arguments: { prompt: "一只猫" } } });
});

test("`input` keeps priority, and other free-text required parameters still keep the model closed", async () => {
  const withInput = { ...seedream, inputSchema: { ...seedream.inputSchema, required: [], properties: { ...seedream.inputSchema.properties, input: { type: "string" } } } };
  assert.equal((await directMediaTool("doubao-seedream-5-0-260128", rows, async () => withInput))?.prompt, "input");
  // 685-like: prompt + reference_url both free text and required -> closed.
  const twoFree = { ...seedream, inputSchema: { ...seedream.inputSchema, required: ["prompt", "reference_url"], properties: { ...seedream.inputSchema.properties, reference_url: { type: "string" } } } };
  assert.equal(await directMediaTool("doubao-seedream-5-0-260128", rows, async () => twoFree), null);
  // An enum prompt is not free text.
  const enumPrompt = { ...seedream, inputSchema: { ...seedream.inputSchema, properties: { prompt: { type: "string", enum: ["a"] } } } };
  assert.equal(await directMediaTool("doubao-seedream-5-0-260128", rows, async () => enumPrompt), null);
  // Video-like projection with no text field at all stays closed.
  const noText = { ...seedream, inputSchema: { type: "object", additionalProperties: false, properties: { aspect_ratio: {}, seed: {} } } };
  assert.equal(await directMediaTool("doubao-seedream-5-0-260128", rows, async () => noText), null);
});

test("the first usable bound row wins when several tools map to one model", async () => {
  const many = [{ id: 685, imported: true, status: "ready", mediaModel: "m" }, { id: 684, imported: true, status: "ready", mediaModel: "m" }];
  const load = async (id: number) => id === 685
    ? { ...seedream, model: "m", invocation: { toolId: 685, revision: "8" }, inputSchema: { ...seedream.inputSchema, required: ["prompt", "reference_url"], properties: { prompt: { type: "string" }, reference_url: { type: "string" } } } }
    : { ...seedream, model: "m" };
  assert.equal((await directMediaTool("m", many, load))?.toolId, 684);
});

// MUYU-365 exp5: TEST Core lists 1197 catalog rows 20 per page; the bound media rows (684…) are far past page 1,
// so direct media must read every page (100 per page, until hasMore is false, bounded).
test("direct media reads every catalog page, not only the first", async () => {
  const { registerPlatformRuntime } = await import("../src/contracts/platform-runtime.ts");
  const { listToolCatalogPages } = await import("../src/addons/conversation/api/toolCatalog.ts");
  const calls: string[] = [];
  const page = (n: number) => ({ data: { page: n, pageSize: 100, total: 250, hasMore: n < 3,
    data: n < 3 ? [{ id: n, name: `t${n}` }] : [{ id: 684, name: "文生图", imported: true, status: "ready", mediaModel: "doubao-seedream-5-0-260128" }] } });
  const off = registerPlatformRuntime({ http: { get: async (url: string) => { calls.push(url); return page(Number(new URL(url, "http://x").searchParams.get("page"))); } } } as never);
  try {
    const rows = await listToolCatalogPages();
    assert.deepEqual(calls, [1, 2, 3].map((n) => `/api/v1/addons/tool/catalog?page=${n}&pageSize=100`));
    assert.deepEqual(rows.map((row) => row.id), [1, 2, 684]);
    assert.equal(rows[2].mediaModel, "doubao-seedream-5-0-260128");
  } finally { off(); }
});

test("paged catalog read is bounded and keeps the older-core 404 = [] contract", async () => {
  const { registerPlatformRuntime } = await import("../src/contracts/platform-runtime.ts");
  const { listToolCatalogPages } = await import("../src/addons/conversation/api/toolCatalog.ts");
  let calls = 0;
  let off = registerPlatformRuntime({ http: { get: async () => { calls++; return { data: { hasMore: true, data: [{ id: calls, name: "x" }] } }; } } } as never);
  try { assert.equal((await listToolCatalogPages(5)).length, 5); assert.equal(calls, 5); } finally { off(); }
  off = registerPlatformRuntime({ http: { get: async () => { throw Object.assign(new Error("nf"), { status: 404 }); } } } as never);
  try { assert.deepEqual(await listToolCatalogPages(), []); } finally { off(); }
});

test("the composer's direct media lookup uses the paged catalog read", async () => {
  const { readFileSync } = await import("node:fs");
  const app = readFileSync(new URL("../src/chat-react/ChatApp.tsx", import.meta.url), "utf8");
  assert.match(app, /Promise\.all\(\[listToolCatalogPages\(\), conversationId \? getSessionBindings\(conversationId\) : null\]\)/);
});
