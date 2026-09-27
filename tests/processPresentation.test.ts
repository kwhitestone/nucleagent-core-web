import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ensureDirectReplyProcessItems,
  ensureExecutionProcessItems,
  formatProcessDuration,
  groupContiguousProcessItems,
  hasDistinctProcessDetails,
  hasProcessItemDetails,
  indexProcessGroupLeaders,
  indexProcessGroupUsers,
  isProcessExpanded,
  isThinkingProcessItem,
  orderTurnItemsForDisplay,
  processPreview,
  processItemForDisplay,
  processDurationMs,
  preferredActiveProcessItemId,
  processStepEndedAt,
  processToolDetails,
  resolveProcessStepDurationMs,
  sumProcessDurationsForDisplay,
} from "../src/addons/conversation/task-conversation/vue/processPresentation.ts";
import type { ConversationItem } from "../src/addons/conversation/task-conversation/core/types.ts";
import { conversationMessages } from "../src/addons/conversation/task-conversation/vue/messages.ts";

test("tool detail labels follow the selected locale", () => {
  assert.equal(conversationMessages["zh-CN"].toolSearchQuery, "搜索：");
  assert.equal(conversationMessages["zh-CN"].toolSearchResults(2), "找到 2 个结果");
  assert.equal(conversationMessages["en-US"].toolSearchQuery, "Search:");
  assert.equal(conversationMessages["en-US"].toolSearchResults(2), "2 results found");
  assert.equal(conversationMessages["en-US"].toolDetailsTruncated, "Some details were truncated");
});

test("active process defaults open but respects explicit disclosure choices", () => {
  const noOverrides = new Set<string>();
  assert.equal(
    isProcessExpanded(noOverrides, "active", "active", noOverrides),
    true,
  );
  assert.equal(
    isProcessExpanded(noOverrides, "history", "active", noOverrides),
    false,
  );
  assert.equal(
    isProcessExpanded(
      new Set(["history"]),
      "history",
      "active",
      noOverrides,
    ),
    true,
  );
  assert.equal(
    isProcessExpanded(noOverrides, "active", "active", new Set(["active"])),
    false,
  );
  assert.equal(
    isProcessExpanded(new Set(["active"]), "active", "active", noOverrides),
    true,
  );
  assert.equal(
    isProcessExpanded(noOverrides, "active", undefined, noOverrides),
    false,
  );
});

test("active thinking remains expanded while initialization has its own bubble", () => {
  const active = (id: string, data?: Readonly<Record<string, unknown>>) => ({
    id,
    lane: "process",
    status: "streaming",
    data,
  });
  assert.equal(preferredActiveProcessItemId([
    active("thinking", { thinking: true }),
    active("init", { executionPhase: "agent_initialization" }),
  ]), "thinking");
  assert.equal(preferredActiveProcessItemId([
    active("init", { executionPhase: "agent_initialization" }),
  ]), "init");
  assert.equal(preferredActiveProcessItemId([
    { ...active("done", { thinking: true }), status: "complete" },
  ]), undefined);
});

test("completed process durations remain visible and stop advancing", () => {
  const start = "2026-08-27T00:00:00.000Z";
  const end = "2026-08-27T00:00:02.500Z";
  const base = Date.parse(start);

  assert.equal(processDurationMs(start, undefined, base + 1_600), 1_600);
  assert.equal(processDurationMs(start, end, base + 60_000), 2_500);
  assert.equal(processDurationMs("not-a-date", end, base), undefined);
  assert.equal(formatProcessDuration(0), "0.0s");
  assert.equal(formatProcessDuration(1_600), "1.6s");
  assert.equal(formatProcessDuration(65_000), "1m 05.0s");
});

test("active tool timing ignores provisional zero and completed timing stays fixed", () => {
  const start = "2026-08-27T00:00:00.000Z";
  const base = Date.parse(start);

  assert.equal(
    resolveProcessStepDurationMs({
      startedAt: start,
      nowMs: base + 2_300,
      status: "streaming",
      explicitDurationMs: 0,
    }),
    2_300,
  );
  assert.equal(
    resolveProcessStepDurationMs({
      startedAt: start,
      nowMs: base + 3_300,
      status: "streaming",
      explicitDurationMs: 0,
    }),
    3_300,
  );
  assert.equal(
    resolveProcessStepDurationMs({
      startedAt: start,
      nowMs: base + 20_000,
      status: "complete",
      explicitDurationMs: 4_900,
    }),
    4_900,
  );
});

test("concurrent active process rows ignore the next row timestamp", () => {
  assert.equal(
    processStepEndedAt({
      status: "streaming",
      nextStepAt: "2026-08-27T00:00:00.050Z",
      settledGroupEnd: "2026-08-27T00:00:10.000Z",
    }),
    undefined,
  );
  assert.equal(
    processStepEndedAt({
      status: "complete",
      nextStepAt: "2026-08-27T00:00:00.050Z",
      settledGroupEnd: "2026-08-27T00:00:10.000Z",
    }),
    "2026-08-27T00:00:00.050Z",
  );
});

test("process total equals the sum of displayed step durations", () => {
  assert.equal(sumProcessDurationsForDisplay([9_940, 4_940]), 14_800);
  assert.equal(
    formatProcessDuration(sumProcessDurationsForDisplay([9_940, 4_940])),
    "14.8s",
  );
  assert.equal(sumProcessDurationsForDisplay([]), undefined);
  assert.equal(sumProcessDurationsForDisplay([1_000, undefined]), undefined);
  assert.equal(
    formatProcessDuration(sumProcessDurationsForDisplay([65_040, 4_940])),
    "1m 09.9s",
  );
});

test("process rows expand only when content contains details beyond the summary", () => {
  assert.equal(processPreview("已完成分析"), "已完成分析");
  assert.equal(hasDistinctProcessDetails("已完成分析"), false);
  assert.equal(hasDistinctProcessDetails("**已完成分析**"), false);
  assert.equal(hasDistinctProcessDetails("已完成分析\n已完成分析"), false);
  assert.equal(hasDistinctProcessDetails("  \n---\n```\n"), false);

  const detailed = "已检查请求参数\n已选择联网搜索\n联网搜索完成 · 1.6 秒";
  assert.equal(processPreview(detailed), "联网搜索完成 · 1.6 秒");
  assert.equal(hasDistinctProcessDetails(detailed), true);
  assert.equal(
    hasDistinctProcessDetails("这是一段没有换行但足够长的思考过程。".repeat(12)),
    true,
  );
});

test("system tool previews leave their duration in the dedicated elapsed slot", () => {
  const data = Object.freeze({ toolCallId: "call-1", toolStatus: "completed", durationMs: 100 });
  for (const label of ["使用工具", "执行命令", "联网搜索", "修改文件", "读取文件", "搜索文件", "委托任务", "分析"]) {
    assert.equal(processPreview(`${label}完成 · 0.1 秒`, data), `${label}完成`);
    assert.equal(processPreview(`${label}失败 · 0.1 秒`, { ...data, toolStatus: "failed" }), `${label}失败`);
  }
  assert.equal(processPreview("使用工具完成 · 65.0 秒", { ...data, durationMs: 65_000 }), "使用工具完成");
  assert.deepEqual(data, { toolCallId: "call-1", toolStatus: "completed", durationMs: 100 });
});

test("tool preview cleanup preserves authored time references and full details", () => {
  const data = { toolCallId: "call-1", toolStatus: "completed", durationMs: 100 };
  for (const content of [
    "等待下一次重试 · 0.1 秒",
    "示例：使用工具完成 · 0.1 秒",
    "**使用工具完成 · 0.1 秒**",
    "工具输出\n使用工具完成 · 0.1 秒",
  ]) {
    assert.equal(processPreview(content, data), processPreview(content));
  }
  const generated = "使用工具完成 · 0.1 秒";
  for (const metadata of [
    undefined,
    { durationMs: 100 },
    { ...data, toolCallId: "" },
    { ...data, toolStatus: "running" },
    { ...data, toolStatus: "failed" },
    { ...data, durationMs: undefined },
    { ...data, durationMs: "100" },
    { ...data, durationMs: -1 },
    { ...data, durationMs: Number.NaN },
    { ...data, durationMs: Number.POSITIVE_INFINITY },
    { ...data, durationUnavailable: true },
    { ...data, thinking: true },
    { ...data, plan: { steps: [] } },
  ]) {
    assert.equal(processPreview(generated, metadata), generated);
  }
  const details = Object.freeze({ query: "搜索耗时 0.1 秒", resultCount: 1 });
  assert.equal(processPreview(generated, { ...data, toolDetails: details }), "使用工具完成");
  assert.deepEqual(processToolDetails({ toolDetails: details }), { query: "搜索耗时 0.1 秒", resultCount: 1 });
  assert.equal(generated, "使用工具完成 · 0.1 秒");
});

test("streaming child-agent output is expandable and previews its latest output", () => {
  const content = [
    "状态：正在执行",
    "任务：写第一首诗",
    "过程：正在构思意象",
    "输出：星光落在窗前",
  ].join("\n");

  assert.equal(hasProcessItemDetails(content), true);
  assert.equal(processPreview(content), "输出：星光落在窗前");
});

test("structured tool details make a status-only process row expandable", () => {
  const data = {
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
          url: "data:text/html,boom",
        },
      ],
    },
  };

  assert.equal(hasProcessItemDetails("联网搜索完成 · 1.6 秒", data), true);
  assert.equal(hasProcessItemDetails("联网搜索完成 · 1.6 秒", undefined), false);
  assert.deepEqual(processToolDetails(data), {
    query: "福州天气",
    resultCount: 2,
    truncated: true,
    sources: [
      {
        title: "福州天气预报",
        domain: "weather.example",
        url: "https://weather.example/fuzhou",
      },
      { title: "不安全来源" },
    ],
  });
  assert.equal(processToolDetails({ toolDetails: { sources: [] } }), undefined);
  assert.equal(processToolDetails({ toolDetails: null }), undefined);
  assert.equal(
    processToolDetails({
      toolDetails: {
        query: "   ",
        resultCount: -1,
        truncated: "yes",
        sources: [null, {}, { url: "https://" }],
      },
    }),
    undefined,
  );
  assert.deepEqual(
    processToolDetails({
      toolDetails: { resultCount: 0, truncated: false, sources: "none" },
    }),
    { resultCount: 0, truncated: false },
  );
  const bounded = processToolDetails({
    toolDetails: {
      query: "q".repeat(600),
      sources: Array.from({ length: 12 }, (_, index) => ({
        title: `source-${index}`,
        url: `https://source-${index}.example/result`,
      })),
    },
  });
  assert.equal(bounded?.query?.length, 512);
  assert.equal(bounded?.sources?.length, 10);
  assert.equal(bounded?.truncated, true);
});

test("thinking markers make both live and archived reasoning expandable", () => {
  assert.equal(isThinkingProcessItem({ thinking: true }), true);
  assert.equal(isThinkingProcessItem({ thinking: false }), false);
  assert.equal(isThinkingProcessItem(undefined), false);
});

test("completed direct replies receive one expandable process summary", () => {
  const item = (
    overrides: Partial<ConversationItem> & Pick<ConversationItem, "id">,
  ): ConversationItem => ({
    turnId: "main",
    streamId: overrides.id,
    lane: "answer",
    role: "assistant",
    kind: "result",
    content: "done",
    status: "complete",
    revision: 1,
    seq: 1,
    timestamp: "2026-08-31T00:00:04.400Z",
    ...overrides,
  });
  const items = [
    item({
      id: "user-1",
      role: "user",
      kind: "text",
      content: "你好",
      timestamp: "2026-08-31T00:00:00.000Z",
    }),
    item({ id: "answer-1" }),
  ];

  const enriched = ensureDirectReplyProcessItems(items, {
    title: "思考过程",
    content: "模型未返回可展示的中间过程，本轮已直接完成回复。",
  });

  assert.deepEqual(enriched.map((current) => current.id), [
    "user-1",
    "direct-process-answer-1",
    "answer-1",
  ]);
  assert.deepEqual(enriched[1], {
    id: "direct-process-answer-1",
    turnId: "main",
    streamId: "direct-process-answer-1",
    lane: "process",
    role: "assistant",
    kind: "plan",
    content: "模型未返回可展示的中间过程，本轮已直接完成回复。",
    status: "complete",
    revision: 1,
    seq: 1,
    timestamp: "2026-08-31T00:00:00.000Z",
    userReadable: true,
    title: "思考过程",
    data: { thinking: true, synthetic: true },
  });
  assert.deepEqual(items.map((current) => current.id), ["user-1", "answer-1"]);

  const withProcess = ensureDirectReplyProcessItems(
    [
      items[0],
      item({ id: "thinking-1", lane: "process", kind: "plan" }),
      items[1],
      item({
        id: "user-2",
        role: "user",
        kind: "text",
        timestamp: "2026-08-31T00:01:00.000Z",
      }),
      item({ id: "answer-2" }),
    ],
    { title: "思考过程", content: "fallback" },
  );
  assert.deepEqual(withProcess.map((current) => current.id), [
    "user-1",
    "thinking-1",
    "answer-1",
    "user-2",
    "direct-process-answer-2",
    "answer-2",
  ]);
});

test("initialization, thinking and tools share one enclosing disclosure group", () => {
  const items = [
    { id: "user-1", lane: "answer" },
    { id: "init-1", lane: "process", data: { executionPhase: "agent_initialization" } },
    { id: "thinking-1", lane: "process" },
    { id: "search-1", lane: "process" },
    { id: "answer-1", lane: "answer" },
    { id: "thinking-2", lane: "process" },
    { id: "answer-2", lane: "answer" },
  ] as const;

  const groups = groupContiguousProcessItems(items);
  assert.deepEqual(
    groups.map((group) => group.map((item) => item.id)),
    [["init-1", "thinking-1", "search-1"], ["thinking-2"]],
  );

  assert.deepEqual(
    [...indexProcessGroupLeaders(items)],
    [
      ["init-1", "init-1"],
      ["thinking-1", "init-1"],
      ["search-1", "init-1"],
      ["thinking-2", "thinking-2"],
    ],
  );
});

test("505 initialization alone does not suppress the direct model response phase", () => {
  const user: ConversationItem = {
    id: "user-505", turnId: "main", streamId: "user-505", lane: "answer", role: "user",
    kind: "text", content: "你好", status: "complete", revision: 1, seq: 1,
    timestamp: "2026-09-07T23:14:59.712+08:00",
  };
  const init: ConversationItem = {
    ...user, id: "init-505", streamId: "init-505", lane: "process", role: "system", kind: "status", content: "",
    timestamp: "2026-09-07T23:14:59.822+08:00",
    data: { executionPhase: "agent_initialization", phaseStatus: "completed", phaseDurationMs: 4527 },
  };
  const answer: ConversationItem = {
    ...user, id: "answer-505", streamId: "answer-505", role: "assistant", kind: "result",
    content: "你好！有什么我可以帮你的吗？", timestamp: "2026-09-07T23:15:07.252+08:00",
  };
  const fallback = { title: "思考过程", responseTitle: "模型响应", content: "模型未返回可展示的中间过程，本轮已直接完成回复。" };
  const rows = ensureDirectReplyProcessItems([user, init, answer], fallback);
  assert.deepEqual(rows.map(row => row.id), [user.id, init.id, `direct-process-${answer.id}`, answer.id]);
  const response = rows[2]!;
  assert.equal(response.title, "模型响应");
  assert.equal(response.content, fallback.content);
  assert.equal(response.timestamp, "2026-09-07T15:15:04.349Z");
  assert.equal(response.data?.durationEstimated, true);
  assert.equal(resolveProcessStepDurationMs({ startedAt: response.timestamp, endedAt: answer.timestamp, status: response.status, nowMs: Date.now() }), 2903);
  assert.equal(groupContiguousProcessItems(rows).length, 1);
  assert.deepEqual(ensureDirectReplyProcessItems(rows, fallback), rows, "do not duplicate a model response row");
  const tool = { ...init, id: "tool-505", data: {}, kind: "tool_call" as const, role: "tool" as const };
  assert.deepEqual(ensureDirectReplyProcessItems([user, init, tool, answer], fallback), [user, init, tool, answer]);
  const unknownInit = { ...init, data: { executionPhase: "agent_initialization", phaseStatus: "unavailable" } };
  const unknownRows = ensureDirectReplyProcessItems([user, unknownInit, answer], fallback);
  assert.equal(unknownRows[2]?.title, "模型响应");
  assert.equal(unknownRows[2]?.data?.durationUnavailable, true, "unknown preparation end must not fabricate model latency");
  assert.equal(unknownRows[2]?.timestamp, answer.timestamp, "preserve a valid display timestamp without treating it as a measurement");
});

test("late process events stay before the answer within each user exchange", () => {
  const items = [
    { id: "user-1", role: "user", lane: "answer" },
    { id: "thinking-1", role: "assistant", lane: "process" },
    { id: "init-1", role: "system", lane: "process", data: { executionPhase: "agent_initialization" } },
    { id: "answer-1", role: "assistant", lane: "answer" },
    { id: "search-1", role: "tool", lane: "process" },
    { id: "user-2", role: "user", lane: "answer" },
    { id: "answer-2", role: "assistant", lane: "answer" },
    { id: "analysis-2", role: "tool", lane: "process" },
  ] as const;

  const ordered = orderTurnItemsForDisplay(items);

  assert.deepEqual(
    ordered.map((item) => item.id),
    [
      "user-1",
      "init-1",
      "thinking-1",
      "search-1",
      "answer-1",
      "user-2",
      "analysis-2",
      "answer-2",
    ],
  );
  assert.deepEqual(
    items.map((item) => item.id),
    [
      "user-1",
      "thinking-1",
      "init-1",
      "answer-1",
      "search-1",
      "user-2",
      "answer-2",
      "analysis-2",
    ],
    "display ordering must not mutate controller state",
  );
  assert.deepEqual(
    groupContiguousProcessItems(ordered).map((group) =>
      group.map((item) => item.id),
    ),
    [["init-1", "thinking-1", "search-1"], ["analysis-2"]],
  );
});

test("active exchanges place the initialization child before the thinking child", () => {
  const active = [
    { id: "user", role: "user", lane: "answer" },
    { id: "thinking", role: "assistant", lane: "process" },
    { id: "init", role: "system", lane: "process", data: { executionPhase: "agent_initialization" } },
  ] as const;

  assert.deepEqual(
    orderTurnItemsForDisplay(active).map((item) => item.id),
    ["user", "init", "thinking"],
  );
  assert.deepEqual(active.map((item) => item.id), ["user", "thinking", "init"]);
});

test("main bubble timing follows its user submission and survives clarification replies", () => {
  const items = [
    { id: "u1", role: "user", lane: "answer" },
    { id: "init1", role: "system", lane: "process" },
    { id: "think1", role: "assistant", lane: "process" },
    { id: "clarify", role: "assistant", lane: "interaction" },
    { id: "clarify-reply", role: "user", lane: "answer", data: { clarifyResponse: true } },
    { id: "think2", role: "assistant", lane: "process" },
    { id: "u2", role: "user", lane: "answer" },
    { id: "init2", role: "system", lane: "process" },
    { id: "think3", role: "assistant", lane: "process" },
  ];
  assert.deepEqual([...indexProcessGroupUsers(items)], [
    ["init1", "u1"], ["think2", "u1"], ["init2", "u2"],
  ]);
  assert.equal(indexProcessGroupUsers([{ id: "orphan", role: "assistant", lane: "process" }]).size, 0);
});

test("waiting, cancelled and failed runs retain a main bubble before any native process", () => {
  const user = {
    id: "user", turnId: "main", streamId: "user", role: "user", lane: "answer",
    kind: "text", content: "hello", status: "complete", revision: 1, seq: 1,
    timestamp: "2026-09-07T00:00:00Z",
  } as const;
  const fallback = { title: "思考中", waiting: "等待响应…", settled: "未记录过程详情。" };
  for (const active of [true, false]) {
    const timing = new Map([[user.id, { active, totalMs: 20_000 }]]);
    const result = ensureExecutionProcessItems([user], timing, fallback);
    assert.equal(result.length, 2);
    assert.equal(result[1]?.status, active ? "streaming" : "complete");
    assert.equal(result[1]?.timestamp, user.timestamp);
    assert.equal(result[1]?.content, active ? fallback.waiting : fallback.settled);
    assert.deepEqual([...indexProcessGroupUsers(result)], [[result[1]!.id, user.id]]);
    const error: ConversationItem = { ...user, id: "error", role: "system", lane: "system", kind: "error", status: "failed" };
    const failed = ensureExecutionProcessItems([user, error], new Map([[user.id, { active: false, totalMs: 10 }]]), fallback);
    assert.equal(failed[1]?.status, "failed");
    assert.equal(failed[2], error);
    assert.deepEqual(ensureExecutionProcessItems(result, timing, fallback), result, "never duplicate native/synthetic process");
  }
  assert.deepEqual(ensureExecutionProcessItems([user], new Map(), fallback), [user], "do not invent a historical endpoint");
  const cancelled = ensureExecutionProcessItems(
    [user], new Map([[user.id, { active: false, totalMs: 4000 }]]), fallback,
    { userId: user.id, status: "cancelled" },
  );
  assert.equal(cancelled[1]?.status, "cancelled", "cancellation before any native output is not completion");
});

test("heartbeat content leaves timing to the right-hand slots without altering model output", () => {
  const heartbeat: ConversationItem = {
    id: "thinking", turnId: "main", streamId: "thinking", role: "assistant", lane: "process",
    kind: "plan", content: "模型正在处理请求，已等待 3786 秒；等待首个可展示内容…",
    status: "streaming", revision: 1, seq: 1, data: { thinkingStatus: true },
  };
  assert.equal(processItemForDisplay(heartbeat, "zh-CN").content, "正在处理请求，等待首个可展示内容…");
  assert.match(heartbeat.content, /3786 秒/);
  assert.equal(processItemForDisplay(heartbeat, "en-US").content, "Processing the request, waiting for the first content…");
  assert.equal(processItemForDisplay({ ...heartbeat, status: "complete" }, "en-US").content, "Finished waiting.");
  const modelOutput = { ...heartbeat, data: { thinking: true } };
  assert.equal(processItemForDisplay(modelOutput, "zh-CN"), modelOutput);
});

const conversationViewSource = readFileSync(
  new URL("../src/addons/conversation/views/conversation.css", import.meta.url),
  "utf8",
);
const taskConversationSource = readFileSync(
  new URL(
    "../src/addons/conversation/task-conversation/vue/TaskConversation.vue",
    import.meta.url,
  ),
  "utf8",
);
const conversationAdapterSource = readFileSync(
  new URL(
    "../src/addons/conversation/composables/useConversationAdapter.ts",
    import.meta.url,
  ),
  "utf8",
);
const taskConversationStyles = readFileSync(
  new URL("../src/addons/conversation/task-conversation/styles.css", import.meta.url),
  "utf8",
);

test("conversation switches reset process disclosure choices", () => {
  const conversationKeyWatch = taskConversationSource.match(
    /watch\(\s*\(\) => props\.conversationKey,[\s\S]*?\n\);/,
  )?.[0];
  assert.ok(conversationKeyWatch, "missing conversationKey watcher");
  assert.match(conversationKeyWatch, /expandedProcessIds\.value\s*=\s*new Set\(\)/);
  assert.match(conversationKeyWatch, /collapsedProcessIds\.value\s*=\s*new Set\(\)/);
  assert.match(conversationKeyWatch, /collapsedProcessStepIds\.value\s*=\s*new Set\(\)/);
  assert.match(conversationKeyWatch, /controller\.initialize\(\)/);
});

const cssRule = (selector: string): string => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = conversationViewSource.match(
    new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`),
  )?.[1];
  assert.ok(rule, `missing CSS rule for ${selector}`);
  return rule;
};

test("conversation process rows use the available width without truncating previews", () => {
  const processRule = cssRule(".chat-view .atc-process");
  assert.match(processRule, /width:\s*calc\(100%\s*-\s*40px\)/);
  assert.doesNotMatch(processRule, /width:\s*fit-content/);

  const summaryRule = cssRule(".chat-view .atc-process-summary");
  assert.match(summaryRule, /align-items:\s*flex-start/);
  assert.match(summaryRule, /width:\s*100%/);
  assert.match(summaryRule, /max-width:\s*none/);

  const labelRule = cssRule(".chat-view .atc-process-label");
  assert.match(labelRule, /flex:\s*0\s+1\s+auto/);
  assert.match(labelRule, /min-width:\s*0/);
  assert.match(labelRule, /white-space:\s*normal/);
  assert.match(labelRule, /overflow-wrap:\s*anywhere/);

  const previewRule = cssRule(".chat-view .atc-process-preview");
  assert.match(previewRule, /min-width:\s*0/);
  // A readable basis + a wrapping summary: on narrow screens the preview moves to
  // its own row instead of shrinking to one letter per line (UNI-MOBILE-IMPL §10;
  // the old zero basis caused exactly that). Real layout: processSummaryLayout.test.ts.
  assert.match(previewRule, /flex:\s*1\s+1\s+10em/);
  assert.match(summaryRule, /flex-wrap:\s*wrap/);
  assert.match(previewRule, /overflow:\s*visible/);
  assert.match(previewRule, /text-overflow:\s*clip/);
  assert.match(previewRule, /white-space:\s*normal/);
  assert.match(previewRule, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(previewRule, /text-overflow:\s*ellipsis/);

  const elapsedRule = cssRule(".chat-view .atc-process-elapsed");
  assert.match(elapsedRule, /margin-left:\s*auto/);
  assert.match(elapsedRule, /white-space:\s*nowrap/);
});

test("process template groups status steps behind one meaningful disclosure", () => {
  assert.match(taskConversationSource, /ensureDirectReplyProcessItems\(/);
  assert.match(taskConversationSource, /isThinkingProcessItem\(item\.data\)/);
  assert.match(taskConversationSource, /processGroupFor\(item\)/);
  assert.match(taskConversationSource, /class="atc-process atc-process-group"/);
  assert.match(
    taskConversationSource,
    /v-for="processItem in processGroupItems\(item\.id\)"/,
  );
  assert.match(
    taskConversationSource,
    /canToggleProcessStep\(processItem\) \? 'details' : 'div'/,
  );
  assert.match(
    taskConversationSource,
    /canToggleProcessStep\(processItem\) \? 'summary' : 'div'/,
  );
  assert.match(
    taskConversationSource,
    /class="atc-process-step-summary"[\s\S]*@click\.prevent="toggleProcessStep\(processItem\)"/,
  );
  assert.match(taskConversationSource, /class="atc-process-step-content"/);
  assert.match(taskConversationSource, /class="atc-process-chevron"/);
  assert.match(
    taskConversationSource,
    /:aria-label="`\$\{text\.process\} · \$\{processGroupSummary\(item\.id\)\}`"/,
  );
  assert.match(
    taskConversationSource,
    /anchorElementForItemId\(props\.initialAnchor\)/,
  );
  assert.match(
    taskConversationSource,
    /processGroupLeaderByItemId\.value\.get\(itemId\)/,
  );
  // The enclosing summary owns total timing; lifecycle rows use the same child renderer.
  const mainSummary = taskConversationSource.match(/<summary\s+class="atc-process-summary"[\s\S]*?<\/summary>/)?.[0] ?? "";
  assert.match(mainSummary, /class="atc-process-elapsed atc-execution-timing"/);
  assert.match(mainSummary, /processGroupTimingText\(item\.id\)/);
  assert.doesNotMatch(taskConversationSource, /class="atc-process atc-process-phase"/);
  assert.match(taskConversationSource, /'atc-process-phase': isExecutionPhaseProcessItem\(processItem\)/);
  assert.match(conversationAdapterSource, /executionPhaseLabel\(messageTimingData\(msg\), "zh-CN"\)/);
  assert.match(taskConversationSource, /executionPhaseLabel\(item\.data, props\.locale\)/);
  assert.match(taskConversationSource, /data-agent-init-ms/);
  assert.match(taskConversationSource, /data-agent-init-boundary/);
  assert.match(taskConversationSource, /data-queue-ms/);
  assert.match(taskConversationSource, /:data-execution-phase="processItem\.data\?\.executionPhase"/);
  assert.doesNotMatch(taskConversationSource, /processGroupElapsed\(item\.id\)/);
  assert.match(
    taskConversationSource,
    /processStepElapsed\(processItem, item\.id\)/,
  );
  assert.match(
    taskConversationSource,
    /phaseDurationMs[\s\S]*durationMs/,
  );
  assert.match(
    taskConversationSource,
    /phaseStatus === "unavailable"[\s\S]*return undefined/,
  );
  assert.doesNotMatch(
    taskConversationSource,
    /sumProcessDurationsForDisplay\([\s\S]*processStepDurationMs/,
  );
  assert.match(
    taskConversationStyles,
    /\.atc-process\[open\] > \.atc-process-summary \.atc-process-preview\s*\{[^}]*display:\s*none/s,
  );
  assert.doesNotMatch(taskConversationSource, /atc-process-static/);
});

test("structured web-search details render safe source links", () => {
  assert.match(taskConversationSource, /text\.toolSearchQuery/);
  assert.match(taskConversationSource, /text\.toolSearchResults/);
  assert.match(taskConversationSource, /text\.toolSources/);
  assert.match(taskConversationSource, /text\.toolDetailsTruncated/);
  assert.match(
    taskConversationSource,
    /v-else-if="processPreview\(processItem\)"[\s\S]*class="atc-process-preview"/,
  );
  assert.match(taskConversationSource, /target="_blank"/);
  assert.match(taskConversationSource, /rel="noopener noreferrer"/);
});

test("structured plan cards render steps with status", () => {
  assert.match(
    taskConversationSource,
    /v-if="processPlan\(processItem\)"[\s\S]*class="atc-plan-steps"/,
  );
  assert.match(
    taskConversationSource,
    /:data-status="step\.status"[\s\S]*atc-plan-step/,
  );
  assert.match(taskConversationSource, /planSummary\(processItem\)/);
  assert.match(taskConversationStyles, /\.atc-plan-step-active::after/);
  assert.match(taskConversationStyles, /atc-plan-pulse/);
});
