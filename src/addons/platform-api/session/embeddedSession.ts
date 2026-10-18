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
let businessScope = new AbortController();
let principalId: string | null = null;
let requestGeneration = 0;
let businessBoundaryGeneration = 0;

export function sessionGenerations() {
  return { requestGeneration, businessBoundaryGeneration };
}

function principal(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && /^[1-9][0-9]{0,15}$/.test(id) &&
    Number.isSafeInteger(Number(id)) ? id : null;
}

/** Every trusted session owns its in-flight HTTP requests. */
export function sessionRequestSignal(boundary?: "business"): AbortSignal {
  return boundary === "business" ? businessScope.signal : requestScope.signal;
}

function retireBusinessRequests(): void {
  businessBoundaryGeneration++;
  businessScope.abort();
  businessScope = new AbortController();
}

function retireRequests(): void {
  requestGeneration++;
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
  incomingPrincipal?: unknown,
): { accepted: boolean; changed: boolean } {
  const previousVersion = sessionVersion();
  if (!shouldAcceptShellSession(
    previousVersion,
    rejectedVersion,
    incomingVersion,
    Boolean(token),
  )) return { accepted: false, changed: false };

  const previousToken = getAccessToken();
  const nextPrincipal = token ? principal(incomingPrincipal) : null;
  // An old/unknown producer cannot prove ownership of any protected state.
  if (!nextPrincipal) token = null;
  const authorizationChanged = replaceEmbeddedPermissions(token ? incomingPermissions : []);
  const businessBoundaryChanged = !nextPrincipal || !previousToken ||
    nextPrincipal !== principalId || authorizationChanged;
  const changed = previousToken !== (token ?? "") || previousVersion !== incomingVersion ||
    businessBoundaryChanged;
  principalId = nextPrincipal;
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
    if (businessBoundaryChanged) retireBusinessRequests();
    retireRequests();
    emitSessionChange(Boolean(token), businessBoundaryChanged);
  }
  return { accepted: true, changed };
}

export function handleEmbeddedUnauthorized(reason: "missing" | "rejected"): void {
  const version = sessionVersion();
  if (reason === "rejected") {
    clearAccessToken();
    principalId = null;
    replaceEmbeddedPermissions([]);
    retireBusinessRequests();
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
