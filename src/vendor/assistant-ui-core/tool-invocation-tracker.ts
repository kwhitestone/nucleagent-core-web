/**
 * Build-time stand-in for @assistant-ui/core 0.3.35 `runtimes/tool-invocations/ToolInvocationTracker.js` (vite.config.ts alias).
 * The external-store runtime only constructs a tracker when the adapter sets `unstable_enableToolInvocations`; the
 * island never does (tools run in Core/executor, not in the browser), so the host only ever sees `_toolInvocations === null`
 * and compares against NO_TOOL_EXECUTIONS. Leaving the client-side tool pipeline (and the assistant-stream code only it
 * pulls) out of the island keeps it within the 180 KiB budget.
 * shortcut: no client-side tool execution; drop the alias before enabling `unstable_enableToolInvocations`.
 */
export const NO_TOOL_EXECUTIONS = Promise.resolve();

export class ToolInvocationTracker {
  constructor() {
    throw new Error("tool invocations not bundled");
  }
}
