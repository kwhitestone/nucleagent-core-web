import type { IslandStrings } from "./islandStringsZh";

/** en-US island strings; both locales share one lazy compressed chunk. */
export const EN_STRINGS: IslandStrings = {
    modelControls: "Model controls", turnUsage: "Turn usage", points: "Points", usageUnknown: "Settlement unknown", usagePending: "Settlement pending", usageSettled: "Turn settled",
    effort: "Reasoning effort", effortDefault: "Default", effortLow: "Low", effortMedium: "Medium", effortHigh: "High", effortOff: "not supported by this model",
    effortBackend: "Codex executor only", effortUnverified: "not measured for this model", effortIneffective: "measured: no effect on this model", effortEffective: "measured: takes effect on this model",
    profile: "Model preset", profileNote: "A chosen effort overrides the preset; temperature / top_p / max tokens are not adjustable yet", profileError: "Presets failed to load; reload to retry",
    ioToggle: "Full tool input and output", ioInput: "Input", ioOutput: "Output", ioMore: "Load more: ", ioEmpty: "(empty)", ioMissing: "Not captured", ioError: "Could not load; expand again.",
    upstream: "Upstream",
    reasoning: "Thinking process",
    attachmentPending: "Attachment verification pending; download unavailable",
    stop: "Stop", executor: "Executors", mediaLater: "Coming soon", pickerLabel: "Model and executor",
    newPlaceholder: "Describe your task", hint: "Enter to send · Shift + Enter for a new line", queueSend: "Queue (sent when the current reply ends)",
    genImage: "Generate image", genVideo: "Generate video", mediaLaterTip: "Coming soon", attach: "Add attachment", loading: "Loading conversation…", process: "Process",
    queued: "1 queued", queuedRemove: "Remove queued message", badUpdate: "Malformed message update skipped",
    reload: "Regenerate", edit: "Edit", fork: "Fork chat", good: "Good response", bad: "Bad response", feedbackDetails: "Feedback details", not_helpful: "Not helpful", other: "Other", save: "Save", send: "Send",
    dont_like_the_style: "Don't like the style", too_verbose: "Too verbose", not_factually_correct: "Not factually correct", didnt_fully_follow_instructions: "Didn't fully follow instructions", refused_when_it_shouldnt_have: "Refused when it shouldn't have", being_lazy: "Being lazy",
    toBottom: "Scroll to bottom", earlier: "Load earlier messages", running: "Running", done: "Done", failed: "Failed",
    query: "Query", sources: "Sources", doneSteps: "steps succeeded", cancelled: "Stopped", tool: "Tool", mediaPending: "Generating…", mediaFailed: "Generation failed", thinking: "Thinking…", greeting: "What can I help you finish today?",
    firstToken: "First token", queue: "Queue", upload: "Upload", agentReady: "Agent ready", upstreamFirst: "Upstream first token", sec: "s", approx: "~", serverMeasured: "server-measured",
};
