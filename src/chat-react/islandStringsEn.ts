import type { IslandStrings } from "./islandStringsZh";

/** en-US island strings, a separate lazy chunk so zh-CN sessions never download them. */
export const EN_STRINGS: IslandStrings = {
    effort: "Reasoning effort", effortLow: "Low", effortMedium: "Medium", effortHigh: "High", effortOff: "not supported by this model",
    effortBackend: "Codex executor only", effortUnverified: "not measured for this model", effortIneffective: "measured: no effect on this model", effortEffective: "measured: takes effect on this model",
    upstream: "Upstream",
    reasoning: "Thinking process",
    attachmentPending: "Attachment verification pending; download unavailable",
    stop: "Stop", executor: "Executors", mediaLater: "Coming soon", pickerLabel: "Model and executor",
    newPlaceholder: "Describe your task", hint: "Enter to send · Shift + Enter for a new line", queueSend: "Queue (sent when the current reply ends)",
    genImage: "Generate image", genVideo: "Generate video", mediaLaterTip: "Coming soon", attach: "Add attachment", loading: "Loading conversation…", process: "Process",
    queued: "1 queued", queuedRemove: "Remove queued message", badUpdate: "Malformed message update skipped",
    reload: "Send again (new turn)", toBottom: "Scroll to bottom", earlier: "Load earlier messages", running: "Running", done: "Done", failed: "Failed",
    query: "Query", sources: "Sources", doneSteps: "steps succeeded", cancelled: "Stopped", tool: "Tool", mediaPending: "Generating…", mediaFailed: "Generation failed", thinking: "Thinking…", greeting: "What can I help you finish today?",
    firstToken: "First token", queue: "Queue", upload: "Upload", agentReady: "Agent ready", upstreamFirst: "Upstream first token", sec: "s", approx: "~", serverMeasured: "server-measured",
};
