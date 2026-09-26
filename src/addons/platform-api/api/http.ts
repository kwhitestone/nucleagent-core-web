import axios from "axios";
import type { InternalAxiosRequestConfig } from "axios";
import { getAccessToken, clearAccessToken } from "@/utils/token";
import { ApiError } from "@/contracts/platform-runtime";
import { shouldHandleUnauthorized } from "./authFailurePolicy";
import { handleEmbeddedUnauthorized, isInShell, sessionRequestSignal } from "@/addons/platform-api/session/embeddedSession";
import type { ApiErrorBody } from "./types";
import { coreShellPath, redirectToShellLogin } from "../shellLogin";

/**
 * Shared axios instance for the core backend (:26680).
 *
 * - baseURL comes from VITE_CORE_BACKEND_URL when set (e.g. cross-origin in a
 *   iframe shell), otherwise it is empty and requests use relative
 *   `/api/...` URLs that the Vite dev server proxies to :26680.
 * - Leave endpoint-specific response envelopes intact for the API adapters.
 *   HTTP-level errors are normalized into `ApiError`; cancellation remains
 *   an Axios cancellation rather than a user-facing network failure.
 * - HTTP 401 clears the token only when the failed request used the current
 *   credential. Stale/pre-auth responses cannot erase a newly synchronized
 *   iframe token.
 */
const baseURL = import.meta.env.VITE_CORE_BACKEND_URL?.trim() || "";

const http = axios.create({
  baseURL,
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
  },
});

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = token;
  }
  if (isInShell()) {
    const scope = token ? sessionRequestSignal() : AbortSignal.abort();
    config.signal = config.signal
      ? AbortSignal.any([config.signal as AbortSignal, scope])
      : scope;
  }
  return config;
}, undefined, { synchronous: true });

function redirectToAuth(reason: "missing" | "rejected"): void {
  if (typeof window === "undefined") {
    clearAccessToken();
    return;
  }
  // 嵌入模式（micro-app 沙箱或 iframe）下不做 window.location 硬跳转：
  // iframe 里跳壳会把整个壳加载进 iframe，形成嵌套套娃；micro-app 会劫持壳的
  // URL。只清 token，等壳通过 postMessage 把新 token 推过来（useShellBridge）。
  const w = globalThis as Record<string, unknown>;
  const isEmbedded = w.__MICRO_APP_ENVIRONMENT__ === true ||
    (typeof window !== "undefined" && window.parent !== window);
  if (isEmbedded) {
    handleEmbeddedUnauthorized(reason);
    return;
  }
  clearAccessToken();
  // Standalone: interstitial, then the shell's /login (this site has no login route).
  const shellUrl = import.meta.env.VITE_SHELL_URL ?? "http://localhost:26600";
  const shellPath = coreShellPath(window.location.pathname + window.location.search);
  // Lazy: i18n touches `document` at load, and this module is also loaded by SSR tests.
  void import("@/i18n").then(({ default: i18n }) => redirectToShellLogin(shellUrl, shellPath, {
    title: String(i18n.global.t("login.redirectingTitle")),
    body: String(i18n.global.t("login.redirectingBody")),
  }));
}

http.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isCancel(error)) return Promise.reject(error);
    if (axios.isAxiosError(error)) {
      const status = error.response?.status ?? 0;
      const requestAuthorization = error.config?.headers?.get("Authorization");
      if (
        status === 401 &&
        shouldHandleUnauthorized(getAccessToken(), requestAuthorization)
      ) {
        redirectToAuth(typeof requestAuthorization === "string" ? "rejected" : "missing");
      }
      const body = error.response?.data as ApiErrorBody | undefined;
      const message = [body?.message, body?.detail, error.message, "Network error"]
        .find((value): value is string => typeof value === "string" && value.trim().length > 0)!
        .trim().slice(0, 1024);
      return Promise.reject(new ApiError(message, body?.code ?? "NETWORK_ERROR", status));
    }
    return Promise.reject(error);
  },
);

/**
 * Resolve a full URL + auth headers for a raw `fetch` call (used by the SSE
 * stream, which axios cannot consume incrementally). Mirrors the interceptor
 * logic so the SSE request carries the same Authorization header and base URL.
 */
export function apiBase(): string {
  return baseURL;
}

export function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
  };
  if (token) {
    headers.Authorization = token;
  }
  return headers;
}

/** Apply the same 401 policy to raw fetch consumers such as SSE. */
export function handleUnauthorizedResponse(requestAuthorization?: string): void {
  if (!shouldHandleUnauthorized(getAccessToken(), requestAuthorization)) return;
  redirectToAuth(requestAuthorization ? "rejected" : "missing");
}

export default http;
