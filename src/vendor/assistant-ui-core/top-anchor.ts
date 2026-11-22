/**
 * Build-time stand-in for @assistant-ui/react 0.15.36 `primitives/thread/topAnchor/*` (vite.config.ts plugin, scoped to
 * ThreadViewport.js and MessageRoot.js). Every library use sits behind `turnAnchor === "top"`; the island never sets it
 * (the store defaults to "bottom"), so the viewport calls the reserve hook with `false` and nothing else is reached.
 * MUYU-365 exp109: frees island bytes under the 180 KiB budget.
 * shortcut: drop the plugin before the island passes turnAnchor="top" (tests/auiSessionStubs.test.ts pins this).
 */
const unreachable = (): never => { throw new Error("Top-anchor turns are not bundled in the chat island"); };
/** Called on every viewport render with `enabled === false`; the original only mounts the reserve when enabled. */
export const useTopAnchorReserve = (enabled: boolean): void => { if (enabled) unreachable(); };
export const getActiveTopAnchorAnchorId = unreachable;
export const getActiveTopAnchorTargetId = unreachable;
export const isTopAnchorTurnValid = unreachable;
export const parseCssLength = unreachable;
