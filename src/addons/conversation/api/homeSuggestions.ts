/** Home suggestion cards for the new-chat home (Core addons/conversation/router/home_suggestions.go). */
import { getPlatformRuntime } from "@/contracts/platform-runtime";

/** Raw `data`: null when nothing is stored. Shape is checked by resolveCards. 2 s budget, then the caller falls back. */
export async function fetchHomeSuggestions(): Promise<unknown> {
  const response = await getPlatformRuntime().http.get<{ data?: unknown }>("/api/v1/addons/conversation/home-suggestions", { timeout: 2000 });
  return response.data?.data ?? null;
}
