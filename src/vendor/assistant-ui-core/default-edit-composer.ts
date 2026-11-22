/**
 * Build-time stand-in for @assistant-ui/core 0.3.35 `runtime/base/default-edit-composer-runtime-core.js`
 * (vite.config.ts plugin, scoped to base-thread-runtime-core.js). The only construction is in BaseThreadRuntimeCore.beginEdit,
 * which the external-store thread runtime refuses unless the adapter has `onEdit`. The island passes none: its own edit
 * button sends a fresh message through Core (MessageActions), never aui's edit composer.
 * MUYU-365 exp109: frees island bytes under the 180 KiB budget.
 * shortcut: drop the plugin before the island passes onEdit (tests/auiSessionStubs.test.ts pins this).
 */
export class DefaultEditComposerRuntimeCore {
  constructor() { throw new Error("The aui edit composer is not bundled in the chat island"); }
}
