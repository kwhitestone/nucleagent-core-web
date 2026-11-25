/**
 * Build-time stand-in for @assistant-ui/core 0.3.35 `runtime/base/dictation-session.js` (vite.config.ts alias).
 * The chat island configures no dictation adapter, so a session can never start; every member below behaves as the
 * original does in that state, and the session machinery is left out of the island bundle (180 KiB budget).
 * shortcut: no dictation support; drop the alias before passing `adapters.dictation` to the runtime.
 */
export class DictationSessionController {
  readonly dictation = undefined;
  // The island passes no dictation adapter, so the original's not-configured answer is the only one reachable.
  constructor(_host: { getAdapter(): unknown }) {}
  rebase() {}
  cancel() {}
  stopDictation() {}
  startDictation() { throw new Error("Dictation adapter not configured"); }
}
