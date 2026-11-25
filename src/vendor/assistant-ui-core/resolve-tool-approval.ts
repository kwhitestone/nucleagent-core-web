/**
 * Build-time stand-in for @assistant-ui/core 0.3.35 `runtime/utils/resolveToolApprovalResponse.js` (vite.config.ts alias).
 * The library calls it only when a tool-call part carries a pending `approval` and the user answers it. Island tool-call
 * parts never carry `approval` (threadMessages.ts) and the island gives no onRespondToToolApproval: tools are approved in
 * Core/executor, not in the browser. MUYU-365 exp104 keeps the 180 KiB island budget with the profile UI back on.
 * shortcut: drop the alias before the island renders tool approvals (tests/auiSessionStubs.test.ts pins this).
 */
export function resolveToolApprovalResponse(): never {
  throw new Error("tool approvals not bundled");
}
