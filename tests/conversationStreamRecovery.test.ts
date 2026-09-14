import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createServer, type ViteDevServer } from "vite";
import {
  advanceMessageCursor,
  createConversationStreamVersionTracker,
  normalizeSSECursor,
  snapshotMessageCursor,
} from "../src/addons/conversation/composables/conversationStreamPolicy.ts";

let vite: ViteDevServer;
let http: any;
let createConversationAdapter: (key: () => string) => any;
let reduceConversation: (state: any, action: any) => any;
let createConversationState: (key: string) => any;
let unregisterPlatform: () => void;

before(async () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    },
  });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  ({ default: http } = await vite.ssrLoadModule("/src/addons/platform-api/api/http.ts"));
  const { platformRuntime } = await vite.ssrLoadModule("/src/addons/platform-api/runtime.ts");
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregisterPlatform = registerPlatformRuntime(platformRuntime);
  ({ createConversationAdapter } = await vite.ssrLoadModule("/src/addons/conversation/composables/useConversationAdapter.ts"));
  ({ reduceConversation, createConversationState } = await vite.ssrLoadModule("/src/addons/conversation/task-conversation/core/reducer.ts"));
});

after(async () => {
  unregisterPlatform();
  await vite.close();
  Reflect.deleteProperty(globalThis, "fetch");
  Reflect.deleteProperty(globalThis, "localStorage");
});

const message = (overrides: Record<string, unknown>) => ({
  id: 1,
  conversationId: 284,
  senderType: "agent",
  senderName: "agent",
  msgType: "result",
  content: "done",
  metadata: {},
  createdAt: "2026-08-27T14:45:00.000+08:00",
  ...overrides,
});

test("queue snapshot and SSE position changes keep one independently timed process row", async () => {
  const queued = message({ id: 7301, conversationId: 730, senderType: "system", senderName: "execution_queue", msgType: "status", content: "排队等待 · 3 秒", metadata: {
    step_id: "queue-step", execution_phase: "execution_queue", phase_status: "running", queue_position: 3, queue_reason: "executor_capacity",
  } });
  http.defaults.adapter = async (config: any) => ({ config, data: messageEnvelope(config, [queued]), headers: {}, status: 200, statusText: "OK" });
  const moved = { ...queued, metadata: { ...queued.metadata, queue_position: 1 } };
  const completed = { ...queued, metadata: { ...queued.metadata, phase_status: "completed", duration_ms: 5321 } };
  globalThis.fetch = (async () => new Response([moved, completed].map(row =>
    `id: ${row.id}\nevent: message-updated\ndata: ${JSON.stringify(row)}\n\n`).join(""),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  )) as typeof fetch;
  const adapter = createConversationAdapter(() => "730");
  const snapshot = await adapter.loadSnapshot({ conversationKey: "730", signal: new AbortController().signal });
  const item = snapshot.items[0];
  assert.equal(snapshot.status, "running");
  assert.equal(item.lane, "process");
  assert.equal(item.title, "排队等待");
  assert.equal(item.content, "", "the row's elapsed slot owns its timer");
  assert.equal(item.status, "streaming");
  assert.equal(item.data.queuePosition, 3);
  const updates = [];
  for await (const event of adapter.subscribe({ conversationKey: "730", cursor: snapshot.cursor, signal: new AbortController().signal })) updates.push(event);
  assert.equal(updates.length, 2);
  assert.deepEqual(updates.map((event: any) => [event.item.id, event.item.timestamp, event.item.revision]), [
    [item.id, item.timestamp, 2], [item.id, item.timestamp, 3],
  ]);
  assert.equal(updates[0].item.data.queuePosition, 1);
  assert.equal(updates[1].item.data.phaseDurationMs, 5321);
  assert.equal(updates[1].item.status, "complete");
});

test("cancelled queue history freezes its own phase and never uses initialization labels", async () => {
  const queued = message({ id: 7311, conversationId: 731, senderType: "system", senderName: "execution_queue", msgType: "status", metadata: {
    step_id: "queue-cancel", execution_phase: "execution_queue", phase_status: "running", queue_position: 2,
  } });
  http.defaults.adapter = async (config: any) => ({ config, data: config.url.endsWith("/messages")
    ? { code: 0, data: [queued] } : { code: 0, data: {
      id: 731, status: "cancelled", executionStepId: "queue-cancel", completedAt: "2026-08-27T14:45:02.500+08:00",
    } }, headers: {}, status: 200, statusText: "OK" });
  const snapshot = await createConversationAdapter(() => "731").loadSnapshot({ conversationKey: "731", signal: new AbortController().signal });
  assert.equal(snapshot.items[0].status, "cancelled");
  assert.equal(snapshot.items[0].title, "排队已取消");
  assert.equal(snapshot.items[0].data.phaseDurationMs, 2500);
  assert.equal(snapshot.items[0].data.executionPhase, "execution_queue");
});

test("queue completion missing from SSE freezes as unknown rather than fabricated model wait", async () => {
  const queued = message({ id: 7321, conversationId: 732, senderType: "system", senderName: "execution_queue", msgType: "status", metadata: {
    step_id: "queue-lost", execution_phase: "execution_queue", phase_status: "running",
  } });
  const answer = message({ id: 7322, conversationId: 732, metadata: { step_id: "queue-lost" } });
  globalThis.fetch = (async () => new Response([queued, answer].map(row =>
    `id: ${row.id}\nevent: message-created\ndata: ${JSON.stringify(row)}\n\n`).join(""),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  )) as typeof fetch;
  const updates = [];
  for await (const event of createConversationAdapter(() => "732").subscribe({ conversationKey: "732", signal: new AbortController().signal })) updates.push(event);
  const phases = updates.filter((event: any) => event.item?.id === "msg-7321");
  assert.equal(phases.length, 2);
  assert.equal(phases[1].item.status, "complete");
  assert.equal(phases[1].item.title, "排队耗时未知");
  assert.equal(phases[1].item.data.phaseStatus, "unavailable");
  assert.equal(phases[1].item.data.phaseDurationMs, undefined);
});

// Both endpoints are part of an authoritative conversation snapshot.
const messageEnvelope = (config: any, rows: any[]) => ({
  code: 0,
  data: config.url.endsWith("/messages") ? rows : {
    id: Number(config.url.split("/").at(-1)),
    status: rows.some((m) => m.senderType === "agent" && ["result", "error"].includes(m.msgType))
      ? "completed" : rows.length ? "executing" : "drafting",
    completedAt: null,
  },
});

test("an accepted run without native messages remains running, and cancellation restores its endpoint", async () => {
  const rows = [message({ senderType: "user", senderName: "user", msgType: "text" })];
  for (const status of ["executing", "cancelled"]) {
    http.defaults.adapter = async (config: any) => ({
      config, headers: {}, status: 200, statusText: "OK",
      data: { code: 0, data: config.url.endsWith("/messages") ? rows : {
        id: 284, status, completedAt: status === "cancelled" ? "2026-08-27T14:45:20.000+08:00" : null,
      } },
    });
    const snapshot = await createConversationAdapter(() => "284").loadSnapshot({ conversationKey: "284", signal: new AbortController().signal });
    assert.equal(snapshot.status, status === "executing" ? "running" : "cancelled");
    assert.equal(snapshot.items[0].data.runStoppedAt, status === "cancelled" ? "2026-08-27T14:45:20.000+08:00" : undefined);
  }
});

test("child results retain step identity without emitting a main conversation terminal", async () => {
  globalThis.fetch = (async () => new Response(
    `id: 91\nevent: message-created\ndata: ${JSON.stringify(message({ id: 91, senderName: "researcher", metadata: { step_id: "child-step" } }))}\n\n`,
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  )) as typeof fetch;
  const events = [];
  for await (const event of createConversationAdapter(() => "901").subscribe({ conversationKey: "901", signal: new AbortController().signal })) events.push(event);
  assert.equal(events.length, 1);
  assert.equal(events[0].item.data.runStepId, "child-step");
  assert.equal(events[0].item.data.runTerminal, false);
});

test("agent initialization lifecycle renders as a timed process row", async () => {
  const rows = [
    message({ id: 101, senderType: "user", senderName: "user", msgType: "text", content: "hello" }),
    message({ id: 102, senderType: "system", senderName: "agent.lifecycle.agent_init", msgType: "status", content: "Agent 初始化完成 · 2.5 秒", metadata: {
      step_id: "step-init", execution_phase: "agent_initialization", phase_status: "completed",
      phase_boundary: "hermes_message_start", duration_ms: 2456,
    } }),
  ];
  http.defaults.adapter = async (config: any) => ({
    config,
    data: config.url.endsWith("/messages") ? { code: 0, data: rows } : {
      code: 0, data: { id: 290, status: "executing", executionStepId: "new-step", completedAt: null },
    },
    headers: {}, status: 200, statusText: "OK",
  });
  const snapshot = await createConversationAdapter(() => "284").loadSnapshot({
    conversationKey: "284", signal: new AbortController().signal,
  });
  assert.equal(snapshot.items.length, 2);
  assert.equal(snapshot.items[1].lane, "process");
  assert.equal(snapshot.items[1].userReadable, true);
  assert.equal(snapshot.items[1].status, "complete");
  assert.equal(snapshot.items[1].title, "Agent 初始化");
  assert.equal(snapshot.items[1].content, "");
  assert.deepEqual(snapshot.items[1].data, {
    runStepId: "step-init", mainRun: true, runTerminal: false,
    executionPhase: "agent_initialization", phaseStatus: "completed",
    phaseBoundary: "hermes_message_start", phaseDurationMs: 2456,
  });
});

test("agent initialization process row reflects live, OpenCode, and estimated cancellation states", async () => {
  const cases = [
    {
      key: "285",
      metadata: { step_id: "running", execution_phase: "agent_initialization", phase_status: "running", duration_ms: 0 },
      expected: { status: "streaming", title: "Agent 初始化中", estimated: undefined },
    },
    {
      key: "286",
      metadata: { step_id: "opencode", execution_phase: "agent_initialization", phase_status: "completed", phase_boundary: "opencode_prompt_accepted", duration_ms: 1552 },
      expected: { status: "complete", title: "OpenCode 准备", estimated: undefined },
    },
    {
      key: "287",
      metadata: { step_id: "cancelled", execution_phase: "agent_initialization", phase_status: "cancelled", phase_boundary: "core_terminated_before_ready", duration_ms: 2400, duration_source: "core_wall_clock_cutoff" },
      expected: { status: "cancelled", title: "Agent 初始化已取消", estimated: true },
    },
  ];
  for (const current of cases) {
    const rows = [
      message({ id: Number(current.key) * 10, senderType: "user", senderName: "user", msgType: "text", content: "hello" }),
      message({ id: Number(current.key) * 10 + 1, senderType: "system", senderName: "agent.lifecycle.agent_init", msgType: "status", content: "transport-only", metadata: current.metadata }),
    ];
    http.defaults.adapter = async (config: any) => ({
      config, data: messageEnvelope(config, rows), headers: {}, status: 200, statusText: "OK",
    });
    const snapshot = await createConversationAdapter(() => current.key).loadSnapshot({
      conversationKey: current.key, signal: new AbortController().signal,
    });
    const lifecycle = snapshot.items[1];
    assert.equal(lifecycle.userReadable, true);
    assert.equal(lifecycle.status, current.expected.status);
    assert.equal(lifecycle.title, current.expected.title);
    assert.equal(lifecycle.content, "");
    assert.equal(lifecycle.data.phaseDurationEstimated, current.expected.estimated);
  }
});

test("a terminal snapshot settles an orphaned running initialization without inventing completion", async () => {
  const rows = [
    message({ id: 2880, senderType: "user", senderName: "user", msgType: "text", content: "hello", createdAt: "2026-08-27T14:45:00.000+08:00" }),
    message({ id: 2881, senderType: "system", senderName: "agent.lifecycle.agent_init", msgType: "status", content: "Agent 正在初始化…", createdAt: "2026-08-27T14:45:00.100+08:00", metadata: {
      step_id: "orphan", execution_phase: "agent_initialization", phase_status: "running", duration_ms: 0,
    } }),
    message({ id: 2882, senderType: "agent", senderName: "agent", msgType: "result", content: "done", createdAt: "2026-08-27T14:45:04.000+08:00", metadata: { step_id: "orphan" } }),
  ];
  http.defaults.adapter = async (config: any) => ({
    config,
    data: config.url.endsWith("/messages") ? { code: 0, data: rows } : {
      code: 0, data: { id: 288, status: "completed", completedAt: "2026-08-27T14:45:04.000+08:00" },
    },
    headers: {}, status: 200, statusText: "OK",
  });
  const snapshot = await createConversationAdapter(() => "288").loadSnapshot({
    conversationKey: "288", signal: new AbortController().signal,
  });
  const lifecycle = snapshot.items.find((item: any) => item.id === "msg-2881");
  assert.equal(lifecycle.status, "complete");
  assert.equal(lifecycle.data.phaseStatus, "unavailable");
  assert.equal(lifecycle.data.phaseDurationMs, undefined);
  assert.equal(lifecycle.data.phaseDurationEstimated, undefined);
});

test("an old orphaned initialization stays settled while a newer turn is running", async () => {
  const rows = [
    message({ id: 2900, senderType: "user", senderName: "user", msgType: "text", content: "old", createdAt: "2026-08-27T14:45:00.000+08:00" }),
    message({ id: 2901, senderType: "system", senderName: "agent.lifecycle.agent_init", msgType: "status", content: "Agent 正在初始化…", createdAt: "2026-08-27T14:45:00.100+08:00", metadata: {
      step_id: "old-step", execution_phase: "agent_initialization", phase_status: "running", duration_ms: 0,
    } }),
    message({ id: 2902, senderType: "agent", senderName: "agent", msgType: "result", content: "old done", createdAt: "2026-08-27T14:45:04.000+08:00", metadata: { step_id: "old-step" } }),
    message({ id: 2903, senderType: "user", senderName: "user", msgType: "text", content: "new", createdAt: "2026-08-27T14:46:00.000+08:00" }),
  ];
  http.defaults.adapter = async (config: any) => ({
    config,
    data: config.url.endsWith("/messages") ? { code: 0, data: rows } : {
      code: 0, data: { id: 290, status: "executing", executionStepId: "new-step", completedAt: null },
    },
    headers: {}, status: 200, statusText: "OK",
  });
  const snapshot = await createConversationAdapter(() => "290").loadSnapshot({
    conversationKey: "290", signal: new AbortController().signal,
  });
  assert.equal(snapshot.status, "running");
  const lifecycle = snapshot.items.find((item: any) => item.id === "msg-2901");
  assert.equal(lifecycle.status, "complete");
  assert.equal(lifecycle.data.phaseStatus, "unavailable");
  assert.equal(lifecycle.data.phaseDurationMs, undefined);
});

test("a terminal answer settles a live orphaned initialization row", async () => {
  const phase = message({ id: 2891, senderType: "system", senderName: "agent.lifecycle.agent_init", msgType: "status", content: "Agent 正在初始化…", createdAt: "2026-08-27T14:45:00.100+08:00", metadata: {
    step_id: "orphan-live", execution_phase: "agent_initialization", phase_status: "running", duration_ms: 0,
  } });
  const answer = message({ id: 2892, senderType: "agent", senderName: "agent", msgType: "result", content: "done", createdAt: "2026-08-27T14:45:04.000+08:00", metadata: { step_id: "orphan-live" } });
  globalThis.fetch = (async () => new Response(
    `id: 2891\nevent: message-created\ndata: ${JSON.stringify(phase)}\n\nid: 2892\nevent: message-created\ndata: ${JSON.stringify(answer)}\n\n`,
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  )) as typeof fetch;
  const events = [];
  for await (const event of createConversationAdapter(() => "289").subscribe({
    conversationKey: "289", signal: new AbortController().signal,
  })) events.push(event);
  const lifecycleEvents = events.filter((event: any) => event.type === "item.upsert" && event.item.id === "msg-2891");
  assert.equal(lifecycleEvents.length, 2);
  assert.equal(lifecycleEvents[0].item.status, "streaming");
  assert.equal(lifecycleEvents[1].item.status, "complete");
  assert.equal(lifecycleEvents[1].item.data.phaseStatus, "unavailable");
  assert.equal(lifecycleEvents[1].item.data.phaseDurationMs, undefined);
});

test("snapshot seeds per-stream versions and SSE replay advances without a gap", async () => {
  const rows = [
    message({ id: 10, senderType: "user", senderName: "user", msgType: "text", content: "上海天气" }),
    message({ id: 11, senderName: "agent.thinking", msgType: "streaming", content: "private chain of thought" }),
  ];
  http.defaults.adapter = async (config: any) => ({ config, data: messageEnvelope(config, rows), headers: {}, status: 200, statusText: "OK" });

  let lastEventId: unknown;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    lastEventId = new Headers(init?.headers).get("Last-Event-ID");
    const updated = message({ id: 11, senderName: "agent.thinking", msgType: "streaming", content: "more private reasoning" });
    const body = `id: 11\nevent: message-updated\ndata: ${JSON.stringify(updated)}\n\n`;
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;

  const adapter = createConversationAdapter(() => "284");
  const snapshot = await adapter.loadSnapshot({ conversationKey: "284", signal: new AbortController().signal });
  assert.deepEqual(snapshot.items.map((item: any) => [item.revision, item.seq]), [[1, 1], [1, 1]]);
  assert.equal(snapshot.cursor, "11");
  assert.equal(snapshot.items[1].status, "streaming");
  assert.ok(!snapshot.items[1].content.includes("private chain of thought"));

  const events = adapter.subscribe({ conversationKey: "284", cursor: snapshot.cursor, signal: new AbortController().signal });
  const first = await events.next();
  assert.equal(lastEventId, "11");
  assert.equal(first.value.item.revision, 2);
  assert.equal(first.value.item.seq, 2);
  assert.ok(!first.value.item.content.includes("more private reasoning"));
  await events.return(undefined);

  let state = createConversationState("284");
  state = reduceConversation(state, {
    type: "event.received",
    event: {
      protocolVersion: 2,
      type: "snapshot",
      conversationKey: "284",
      eventId: "snapshot-1",
      cursor: snapshot.cursor,
      turnId: "main",
      streamId: "msg-11",
      lane: "process",
      revision: 1,
      seq: 1,
      timestamp: new Date().toISOString(),
      snapshot,
    },
  });
  state = reduceConversation(state, { type: "event.received", event: first.value });
  assert.equal(state.connection.needsSnapshot, false);
  assert.equal(state.streamVersions["msg-11"].revision, 2);
});

test("server-authorized thinking summary remains visible in snapshots and history", async () => {
  const summary = "先检查请求。\n再选择可用工具。";
  const rows = [
    message({
      id: 12,
      senderName: "agent.thinking",
      msgType: "streaming",
      content: summary,
      metadata: { thinkingVisibility: "summary" },
    }),
    message({ id: 13, senderName: "agent", msgType: "result", content: "answer" }),
  ];
  http.defaults.adapter = async (config: any) => ({
    config,
    data: messageEnvelope(config, rows),
    headers: {},
    status: 200,
    statusText: "OK",
  });

  const snapshot = await createConversationAdapter(() => "284").loadSnapshot({
    conversationKey: "284",
    signal: new AbortController().signal,
  });
  assert.equal(snapshot.items[0].content, summary);
  assert.equal(snapshot.items[0].status, "complete");
  assert.equal(snapshot.items[0].title, "思考过程");
  assert.equal(snapshot.items[0].data?.thinking, true);
});

test("server-authorized full thinking remains visible", async () => {
  const reasoning = "先识别问题。\n再验证关键条件。";
  const rows = [
    message({
      id: 14,
      senderName: "agent.thinking",
      msgType: "streaming",
      content: reasoning,
      metadata: { thinkingVisibility: "full" },
    }),
  ];
  http.defaults.adapter = async (config: any) => ({
    config,
    data: messageEnvelope(config, rows),
    headers: {},
    status: 200,
    statusText: "OK",
  });

  const snapshot = await createConversationAdapter(() => "284").loadSnapshot({
    conversationKey: "284",
    signal: new AbortController().signal,
  });
  assert.equal(snapshot.items[0].content, reasoning);
});

test("server-authored live thinking status remains visible and updates in place", async () => {
  const rows = [
    message({
      id: 19,
      senderName: "agent.status.thinking",
      msgType: "streaming",
      content: "模型正在处理请求，已等待 3 秒；等待首个可展示内容…",
      metadata: { thinkingStatus: true, thinkingVisibility: "status" },
    }),
  ];
  http.defaults.adapter = async (config: any) => ({
    config,
    data: messageEnvelope(config, rows),
    headers: {},
    status: 200,
    statusText: "OK",
  });
  globalThis.fetch = (async () => {
    const updated = message({
      id: 19,
      senderName: "agent.status.thinking",
      msgType: "streaming",
      content: "模型正在处理请求，已等待 4 秒；等待首个可展示内容…",
      metadata: { thinkingStatus: true, thinkingVisibility: "status" },
    });
    const body = `id: 19\nevent: message-updated\ndata: ${JSON.stringify(updated)}\n\n`;
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }) as typeof fetch;

  const adapter = createConversationAdapter(() => "284");
  const snapshot = await adapter.loadSnapshot({
    conversationKey: "284",
    signal: new AbortController().signal,
  });
  assert.equal(
    snapshot.items[0].content,
    "模型正在处理请求，已等待 3 秒；等待首个可展示内容…",
  );
  assert.equal(snapshot.items[0].status, "streaming");
  assert.equal(snapshot.items[0].title, "思考中");
  const events = adapter.subscribe({
    conversationKey: "284",
    cursor: snapshot.cursor,
    signal: new AbortController().signal,
  });
  const first = await events.next();
  assert.equal(
    first.value.item.content,
    "模型正在处理请求，已等待 4 秒；等待首个可展示内容…",
  );
  assert.equal(first.value.item.streamId, "msg-19");
  await events.return(undefined);
});

test("archived transport thinking status is hidden from historical snapshots", async () => {
  const rows = [
    message({
      id: 20,
      senderName: "agent.status.thinking",
      msgType: "plan",
      content: "模型正在处理请求，已等待 4 秒；等待首个可展示内容…",
      metadata: { thinkingStatus: true },
    }),
    message({ id: 21, senderName: "agent", msgType: "result", content: "done" }),
  ];
  http.defaults.adapter = async (config: any) => ({
    config,
    data: messageEnvelope(config, rows),
    headers: {},
    status: 200,
    statusText: "OK",
  });

  const snapshot = await createConversationAdapter(() => "284").loadSnapshot({
    conversationKey: "284",
    signal: new AbortController().signal,
  });

  assert.deepEqual(snapshot.items.map((item: any) => item.streamId), ["msg-21"]);
});

test("terminal agent result emits a completed conversation status event", async () => {
  http.defaults.adapter = async (config: any) => ({
    config,
    data: messageEnvelope(config, []),
    headers: {},
    status: 200,
    statusText: "OK",
  });
  globalThis.fetch = (async () => {
    const result = message({ id: 20, msgType: "result", content: "最终回复" });
    const body = `id: 20\nevent: message-created\ndata: ${JSON.stringify(result)}\n\n`;
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }) as typeof fetch;

  const adapter = createConversationAdapter(() => "284");
  await adapter.loadSnapshot({
    conversationKey: "284",
    signal: new AbortController().signal,
  });
  const events = adapter.subscribe({
    conversationKey: "284",
    signal: new AbortController().signal,
  });
  const resultEvent = await events.next();
  const statusEvent = await events.next();

  assert.equal(resultEvent.value.type, "item.upsert");
  assert.equal(resultEvent.value.item.content, "最终回复");
  assert.equal(statusEvent.value.type, "conversation.status");
  assert.equal(statusEvent.value.status, "completed");
  assert.equal(statusEvent.value.revision, 1);
  assert.equal(statusEvent.value.seq, 1);
  await events.return(undefined);
});

test("native Codex subagent lifecycle tools use user-readable titles", async () => {
  const rows = [
    message({
      id: 30,
      senderType: "tool",
      senderName: "subagent",
      msgType: "tool_call",
      content: "子代理已启动：写第一首诗",
      metadata: { tool_call_id: "spawn-1", tool_status: "completed" },
    }),
    message({
      id: 31,
      senderType: "tool",
      senderName: "subagent_wait",
      msgType: "tool_call",
      content: "子代理进度：3 完成",
      metadata: { tool_call_id: "wait-1", tool_status: "completed" },
    }),
  ];
  http.defaults.adapter = async (config: any) => ({
    config,
    data: messageEnvelope(config, rows),
    headers: {},
    status: 200,
    statusText: "OK",
  });

  const snapshot = await createConversationAdapter(() => "284").loadSnapshot({
    conversationKey: "284",
    signal: new AbortController().signal,
  });
  assert.deepEqual(snapshot.items.map((item: any) => item.title), ["子代理", "等待子代理"]);
});

test("legacy reasoning tool calls stay hidden while real tool details are projected safely", async () => {
  const rows = [
    message({
      id: 15,
      senderType: "tool",
      senderName: "reasoning",
      msgType: "tool_call",
      content: "分析完成",
      metadata: { tool: "webSearch", tool_status: "completed" },
    }),
    message({
      id: 16,
      senderType: "tool",
      senderName: "webSearch",
      msgType: "tool_call",
      content: "分析完成",
      metadata: { tool: "reasoning", tool_status: "completed" },
    }),
    message({
      id: 17,
      senderType: "tool",
      senderName: "reasoning_helper",
      msgType: "tool_call",
      content: "辅助分析完成",
      metadata: { tool: "reasoning_helper", tool_status: "completed" },
    }),
    message({
      id: 18,
      senderType: "tool",
      senderName: "webSearch",
      msgType: "tool_call",
      content: "联网搜索完成 · 1.6 秒",
      metadata: {
        tool_call_id: "call-search-1",
        tool_status: "completed",
        duration_ms: 1600,
        tool_details: {
          query: "福州天气",
          resultCount: 2,
          truncated: true,
          ignored: "must not escape the whitelist",
          sources: [
            {
              title: "福州天气预报",
              domain: "weather.example",
              url: "https://weather.example/fuzhou",
              snippet: "must not escape the whitelist",
            },
            {
              title: "不安全来源",
              domain: "unsafe.example",
              url: "javascript:alert(1)",
            },
            {
              title: 42,
              domain: "http-source.example",
              url: "http://http-source.example/result",
            },
          ],
        },
      },
    }),
  ];
  http.defaults.adapter = async (config: any) => ({
    config,
    data: messageEnvelope(config, rows),
    headers: {},
    status: 200,
    statusText: "OK",
  });

  const snapshot = await createConversationAdapter(() => "284").loadSnapshot({
    conversationKey: "284",
    signal: new AbortController().signal,
  });

  assert.deepEqual(
    snapshot.items.map((item: any) => item.id),
    ["msg-17", "msg-18"],
  );
  assert.deepEqual(snapshot.items[1].data, {
    mainRun: true,
    runTerminal: false,
    toolCallId: "call-search-1",
    toolStatus: "completed",
    durationMs: 1600,
    toolDetails: {
      query: "福州天气",
      resultCount: 2,
      truncated: true,
      sources: [
        {
          title: "福州天气预报",
          domain: "weather.example",
          url: "https://weather.example/fuzhou",
        },
        {
          title: "不安全来源",
          domain: "unsafe.example",
        },
        {
          domain: "http-source.example",
          url: "http://http-source.example/result",
        },
      ],
    },
  });
});

test("historical streaming thinking is completed when a later answer settled", async () => {
  const rows = [
    message({ id: 20, senderName: "agent.thinking", msgType: "streaming", content: "private" }),
    message({ id: 21, senderName: "agent", msgType: "result", content: "answer" }),
  ];
  http.defaults.adapter = async (config: any) => ({ config, data: messageEnvelope(config, rows), headers: {}, status: 200, statusText: "OK" });
  const snapshot = await createConversationAdapter(() => "284").loadSnapshot({ conversationKey: "284", signal: new AbortController().signal });
  assert.equal(snapshot.items[0].status, "complete");
  assert.equal(snapshot.items[0].title, "思考过程");
});

test("thinking lifecycle cache is isolated by conversation", async () => {
  http.defaults.adapter = async (config: any) => ({ config, data: messageEnvelope(config, []), headers: {}, status: 200, statusText: "OK" });
  const bodies = [
    `id: 31\nevent: message-created\ndata: ${JSON.stringify(message({ id: 31, conversationId: 301, senderName: "agent.thinking", msgType: "streaming", content: "private A" }))}\n\n`,
    `id: 41\nevent: message-created\ndata: ${JSON.stringify(message({ id: 41, conversationId: 302, senderName: "agent", msgType: "result", content: "answer B" }))}\n\n`,
  ];
  globalThis.fetch = (async () =>
    new Response(bodies.shift() ?? "", {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })) as typeof fetch;

  const adapterA = createConversationAdapter(() => "301");
  await adapterA.loadSnapshot({ conversationKey: "301", signal: new AbortController().signal });
  const streamA = adapterA.subscribe({ conversationKey: "301", signal: new AbortController().signal });
  const thinkingA = await streamA.next();
  assert.equal(thinkingA.value.item.id, "msg-31");
  await streamA.return(undefined);

  const adapterB = createConversationAdapter(() => "302");
  await adapterB.loadSnapshot({ conversationKey: "302", signal: new AbortController().signal });
  const streamB = adapterB.subscribe({ conversationKey: "302", signal: new AbortController().signal });
  const answerB = await streamB.next();
  assert.equal(answerB.value.item.id, "msg-41");
  const completedB = await streamB.next();
  assert.equal(completedB.value.type, "conversation.status");
  assert.equal(completedB.value.status, "completed");
  const ghost = await streamB.next();
  assert.equal(ghost.done, true);
});

test("an adapter freezes its conversation key across route changes", async () => {
  const requestedURLs: string[] = [];
  http.defaults.adapter = async (config: any) => {
    requestedURLs.push(config.url);
    return { config, data: messageEnvelope(config, []), headers: {}, status: 200, statusText: "OK" };
  };
  let routeConversation = "401";
  const adapter = createConversationAdapter(() => routeConversation);
  routeConversation = "402";

  await adapter.loadSnapshot({ conversationKey: "401", signal: new AbortController().signal });
  assert.equal(requestedURLs.length, 2);
  assert.ok(requestedURLs.every((url) => /\/conversation\/401(?:\/messages)?$/.test(url)));
});

test("a clarify update marks the card answered before the final answer arrives", async () => {
  const pending = message({
    id: 51,
    senderType: "tool",
    senderName: "clarify",
    msgType: "tool_call",
    content: "继续吗？",
    metadata: { request_id: "clarify-1", kind: "clarify" },
  });
  http.defaults.adapter = async (config: any) => ({
    config,
    data: messageEnvelope(config, [pending]),
    headers: {},
    status: 200,
    statusText: "OK",
  });
  globalThis.fetch = (async () => {
    const answered = { ...pending, metadata: { ...pending.metadata, answered: true } };
    const body = `id: 51\nevent: message-updated\ndata: ${JSON.stringify(answered)}\n\n`;
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;

  const adapter = createConversationAdapter(() => "284");
  const snapshot = await adapter.loadSnapshot({ conversationKey: "284", signal: new AbortController().signal });
  assert.equal(snapshot.items[0].data.interactionStatus, "pending");
  const events = adapter.subscribe({ conversationKey: "284", cursor: snapshot.cursor, signal: new AbortController().signal });
  const update = await events.next();
  assert.equal(update.value.item.data.interactionStatus, "answered");

  let state = createConversationState("284");
  state = reduceConversation(state, {
    type: "event.received",
    event: {
      protocolVersion: 2,
      type: "snapshot",
      conversationKey: "284",
      eventId: "snapshot-clarify",
      cursor: snapshot.cursor,
      turnId: "main",
      streamId: "msg-51",
      lane: "answer",
      revision: 1,
      seq: 1,
      timestamp: new Date().toISOString(),
      snapshot,
    },
  });
  state = reduceConversation(state, { type: "event.received", event: update.value });
  assert.equal(state.items["msg-51"].data.interactionStatus, "answered");
  await events.return(undefined);
});

test("stream policy keeps a monotonic cursor and independent versions", () => {
  const tracker = createConversationStreamVersionTracker();
  assert.equal(tracker.current("msg-1"), undefined);
  tracker.seed([{ id: "msg-1", revision: 1, seq: 1 }] as any);
  assert.deepEqual(tracker.current("msg-1"), { revision: 1, seq: 1 });
  assert.deepEqual(tracker.next("msg-1"), { revision: 2, seq: 2 });
  assert.deepEqual(tracker.next("msg-new"), { revision: 1, seq: 1 });

  assert.equal(snapshotMessageCursor([]), undefined);
  assert.equal(snapshotMessageCursor([{ id: 3 }, { id: 12 }] as any), "12");
  assert.equal(normalizeSSECursor(undefined), undefined);
  assert.equal(normalizeSSECursor("0"), undefined);
  assert.equal(normalizeSSECursor("msg-12"), undefined);
  assert.equal(normalizeSSECursor("12"), "12");
  assert.equal(advanceMessageCursor("12", 8), "12");
  assert.equal(advanceMessageCursor(undefined, 8), "8");
});
