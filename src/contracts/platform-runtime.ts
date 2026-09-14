import type { AxiosInstance } from "axios";
import type { Component } from "vue";

export interface AuthorizationSnapshot {
  readonly permissions: { readonly value: readonly string[] };
  readonly can: (permission: string) => boolean;
}

export interface AuthRequiredPayload {
  source: "sub";
  type: "auth-required";
  reason: "missing" | "rejected";
  sessionVersion: number;
}

export interface PlatformRuntime {
  readonly authenticatedView: (view: Component) => Component;
  readonly http: AxiosInstance;
  readonly apiBase: () => string;
  readonly authHeaders: () => Record<string, string>;
  readonly handleUnauthorizedResponse: (requestAuthorization?: string) => void;
  readonly getAccessToken: () => string | null;
  readonly getSessionVersion: () => number;
  readonly isInShell: () => boolean;
  readonly applyShellSession: (
    token: string | null,
    incomingVersion: number,
    incomingPermissions?: readonly unknown[],
  ) => { accepted: boolean; changed: boolean };
  readonly setAuthRequiredNotifier: (
    notifier: ((payload: AuthRequiredPayload) => boolean) | undefined,
  ) => void;
  readonly filterEmbeddedAuthorizedItems: <T extends { permission: string }>(
    items: readonly T[],
    embedded: boolean,
    can: (permission: string) => boolean,
  ) => T[];
  readonly useEmbeddedAuthorization: () => AuthorizationSnapshot;
}

export const SESSION_CHANGE_EVENT = "nucleagent:session-change";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

let activeRuntime: PlatformRuntime | undefined;

export function registerPlatformRuntime(runtime: PlatformRuntime): () => void {
  if (activeRuntime) throw new Error("Platform runtime is already registered");
  activeRuntime = runtime;
  return () => {
    if (activeRuntime === runtime) activeRuntime = undefined;
  };
}

export function getPlatformRuntime(): PlatformRuntime {
  if (!activeRuntime) throw new Error("Platform runtime is not installed");
  return activeRuntime;
}

export const apiBase = (): string => getPlatformRuntime().apiBase();
export const authenticatedRoute = (loader: () => Promise<{ default: Component }>) => async () => (
  getPlatformRuntime().authenticatedView((await loader()).default)
);
export const authHeaders = (): Record<string, string> => getPlatformRuntime().authHeaders();
export const handleUnauthorizedResponse = (requestAuthorization?: string): void => {
  getPlatformRuntime().handleUnauthorizedResponse(requestAuthorization);
};
export const isInShell = (): boolean => getPlatformRuntime().isInShell();
export const applyShellSession = (
  token: string | null,
  incomingVersion: number,
  incomingPermissions?: readonly unknown[],
): { accepted: boolean; changed: boolean } => getPlatformRuntime().applyShellSession(
  token,
  incomingVersion,
  incomingPermissions,
);
export const setAuthRequiredNotifier = (
  notifier: ((payload: AuthRequiredPayload) => boolean) | undefined,
): void => getPlatformRuntime().setAuthRequiredNotifier(notifier);
export function filterEmbeddedAuthorizedItems<T extends { permission: string }>(
  items: readonly T[],
  embedded: boolean,
  can: (permission: string) => boolean,
): T[] {
  return getPlatformRuntime().filterEmbeddedAuthorizedItems(items, embedded, can);
}
export const useEmbeddedAuthorization = (): AuthorizationSnapshot => (
  getPlatformRuntime().useEmbeddedAuthorization()
);
