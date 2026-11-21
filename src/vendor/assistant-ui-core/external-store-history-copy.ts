/**
 * Build-time stand-in for @assistant-ui/core 0.3.35 `react/runtimes/external-store-history-copy.js` (vite.config.ts plugin).
 * useExternalStoreRuntime always constructs one, but calls `attach` / `recordInteraction` only when a runtime-adapters
 * provider supplies `history.unstable_copy`. The island mounts no such provider (Core owns history), so neither is reached.
 * MUYU-365 exp107: frees island bytes under the 180 KiB budget.
 * shortcut: drop the plugin before the island passes a history adapter (tests/auiSessionStubs.test.ts pins this).
 */
export class ExternalStoreHistoryCopy {
  attach(): never { throw new Error("History copy is not bundled in the chat island"); }
  recordInteraction = async (): Promise<never> => { throw new Error("History copy is not bundled in the chat island"); };
}
