/**
 * What boot.ts does when startup rejects.
 *
 * An anonymous visitor is sent to the shell login by the auth guard, which
 * returns false while window.location.assign() is already leaving; the first
 * navigation then aborts and router.isReady() rejects. That is the redirect
 * working, not a failed start: log nothing and show no alert banner (the
 * login interstitial is what the visitor should see). Any other failure, or a
 * runtime-config failure, is still logged and bannered.
 */
export type StartupFailureContext = {
  configLoaded: boolean;
  leavingForLogin: boolean;
  root: HTMLElement | null;
  log: (message: string, error: unknown) => void;
};

export function reportStartupFailure(error: unknown, ctx: StartupFailureContext): void {
  if (ctx.configLoaded && ctx.leavingForLogin) return;
  // Runtime-config errors redact values (key names only). Log so a mount failure is no longer
  // indistinguishable from a config failure; the banner text stays generic.
  ctx.log(`NucleAgent Core startup failed (${ctx.configLoaded ? "app mount" : "runtime config"}):`, error);
  const root = ctx.root;
  if (root) {
    root.setAttribute("role", "alert");
    root.textContent = ctx.configLoaded
      ? "NucleAgent Core failed to start. Please refresh; contact support if it persists."
      : "NucleAgent Core failed to start: runtime configuration is missing, invalid, or unavailable.";
  }
}
