import type { CreateConversationRequest } from "@/addons/conversation/api/types";

/**
 * MUYU-365 D18: TEST experiment entry for per-request reasoning effort low (Core `reasoningEffort`,
 * codex only). The toggle exists only when the page URL explicitly opts in with `?chatEffort=low`
 * (location.search or the shell's hash query); it is never persisted and never a product default.
 */
export function effortExperimentEnabled(search = globalThis.location?.search ?? "", hash = globalThis.location?.hash ?? ""): boolean {
  const q = hash.indexOf("?");
  return new URLSearchParams(search).get("chatEffort") === "low" || (q >= 0 && new URLSearchParams(hash.slice(q + 1)).get("chatEffort") === "low");
}

/** Adds reasoningEffort=low to this one create request only when chosen and the backend accepts it (codex). */
export function withRequestEffort<T extends CreateConversationRequest>(payload: T, low: boolean): T {
  return low && payload.executionBackend === "codex" ? { ...payload, reasoningEffort: "low" } : payload;
}
