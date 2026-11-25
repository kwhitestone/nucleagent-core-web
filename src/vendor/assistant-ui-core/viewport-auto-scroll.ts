/**
 * Build-time stand-in for @assistant-ui/store 0.15.36 `createThreadViewportAutoScroll` (vite.config.ts plugin, scoped to
 * react/dist/context/stores/ThreadViewport.js). The island's one viewport (ScrollViewport.tsx) passes autoScroll and all three
 * scrollToBottomOn* switches as false and owns scrolling itself (anchors, prepends, following; tests/chatScrollPersistence.test.ts),
 * and renders no aui ScrollToBottom / ViewportFooter, so nothing reads `isAtBottom` or registers a content inset.
 * MUYU-365 mtype-v2: frees island bytes under the 180 KiB budget.
 * shortcut: drop the plugin before the island turns aui auto-scroll on or renders those primitives (tests/auiSessionStubs.test.ts pins this).
 */
const noop = (): void => {};
const unreachable = (): never => { throw new Error("viewport auto-scroll not bundled"); };
export const createThreadViewportAutoScroll = () => ({
  attach: () => noop, isAtBottom: true, setHasMessages: noop, runStarted: noop, threadSwitched: noop, messagesPrepended: noop, dispose: noop,
  scrollToBottom: unreachable, registerContentInset: unreachable, setContentInset: unreachable,
});
