import { clearAccessToken, getAccessToken, setAccessToken } from "@/utils/token";
import { emitSessionChange } from "@/contracts/platform-runtime";
import { shouldAcceptShellSession } from "./embeddedSessionPolicy";
import { replaceEmbeddedPermissions } from "./embeddedAuthorization";

const REFRESH_TOKEN_KEY = "nucleagent_refresh_token";
const SESSION_VERSION_KEY = "nucleagent_session_version";

let rejectedVersion: number | null = null;
let lastNotification = "";
let notifyAuthRequired:
  | ((payload: { source: "sub"; type: "auth-required"; reason: "missing" | "rejected"; sessionVersion: number }) => boolean)
  | undefined;
// Version ordering is scoped to this iframe document. Persisted child values
// cannot be authoritative because the shell origin may have had its site data
// reset independently and legitimately restart from version zero.
let currentVersion = 0;
let requestScope = new AbortController();

/** Every trusted session owns its in-flight HTTP requests. */
export function sessionRequestSignal(): AbortSignal {
  return requestScope.signal;
}

function retireRequests(): void {
  requestScope.abort();
  requestScope = new AbortController();
}

export function isInShell(): boolean {
  return typeof window !== "undefined" && window.parent !== window;
}

export function setAuthRequiredNotifier(
  notifier: typeof notifyAuthRequired,
): void {
  notifyAuthRequired = notifier;
}

export function sessionVersion(): number {
  return currentVersion;
}

export function applyShellSession(
  token: string | null,
  incomingVersion: number,
  incomingPermissions: readonly unknown[] = [],
): { accepted: boolean; changed: boolean } {
  const previousVersion = sessionVersion();
  if (!shouldAcceptShellSession(
    previousVersion,
    rejectedVersion,
    incomingVersion,
    Boolean(token),
  )) return { accepted: false, changed: false };

  const previousToken = getAccessToken();
  const authorizationChanged = replaceEmbeddedPermissions(token ? incomingPermissions : []);
  const changed = previousToken !== (token ?? "") || previousVersion !== incomingVersion || authorizationChanged;
  currentVersion = incomingVersion;
  localStorage.setItem(SESSION_VERSION_KEY, String(incomingVersion));
  // A refresh credential belongs only to the shell and must never survive in
  // an iframe origin, including leftovers from older releases.
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  if (token) setAccessToken(token);
  else clearAccessToken();

  if (incomingVersion > previousVersion || !token) rejectedVersion = null;
  lastNotification = "";
  if (changed) {
    retireRequests();
    emitSessionChange(Boolean(token));
  }
  return { accepted: true, changed };
}

export function handleEmbeddedUnauthorized(reason: "missing" | "rejected"): void {
  const version = sessionVersion();
  if (reason === "rejected") {
    clearAccessToken();
    retireRequests();
    rejectedVersion = version;
    emitSessionChange(false);
  }
  if (typeof window === "undefined" || window.parent === window) return;
  const notificationKey = `${version}:${reason}`;
  if (lastNotification === notificationKey) return;
  lastNotification = notificationKey;
  notifyAuthRequired?.({
    source: "sub",
    type: "auth-required",
    reason,
    sessionVersion: version,
  });
}
