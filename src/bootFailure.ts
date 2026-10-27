import { isNavigationFailure, NavigationFailureType } from "vue-router";

/**
 * What boot.ts does when startup rejects.
 *
 * An anonymous visitor is sent to the shell login by the auth guard: it calls
 * window.location.assign() and returns false, so the first navigation aborts
 * and router.isReady() rejects with an ABORTED navigation failure. That one
 * outcome is the redirect working, not a failed start, and is the only thing
 * kept silent: the error must be a vue-router ABORTED failure AND the login
 * redirect must actually have been handed to the browser. Every other error
 * (a real mount failure, a throwing redirect, an abort with no redirect, a
 * cancelled/duplicated navigation) and every runtime-config failure is still
 * logged and bannered.
 */
export type StartupFailureContext = {
  configLoaded: boolean;
  leavingForLogin: boolean;
  root: HTMLElement | null;
  log: (message: string, error: unknown) => void;
};

export function isExpectedLoginRedirectAbort(error: unknown, ctx: Pick<StartupFailureContext, "configLoaded" | "leavingForLogin">): boolean {
  return ctx.configLoaded && ctx.leavingForLogin && isNavigationFailure(error, NavigationFailureType.aborted);
}

export function reportStartupFailure(error: unknown, ctx: StartupFailureContext): void {
  if (isExpectedLoginRedirectAbort(error, ctx)) return;
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
