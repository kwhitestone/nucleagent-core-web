import { getPlatformRuntime } from "@/contracts/platform-runtime";
import type { ChatSuggestion } from "./ChatApp";

/**
 * Home suggestion cards (Core user GET data) → aui suggestions. Mirrors homeSuggestions.ts
 * resolveCards + cardInput + localize without its icon table (that module pulls @lucide/vue).
 * Image/video cards open /generate in Home.vue, so they are dropped here.
 */
export function toSuggestions(data: unknown, locale: string): ChatSuggestion[] {
  const items = (data as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const en = locale.startsWith("en");
  return items.flatMap((raw: unknown) => {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const id = str(r.id);
    if (!id || !str(r.titleZh) || r.enabled === false) return [];
    if (id === "generateImage" || id === "generateVideo") return [];
    const title = (en && str(r.titleEn)) || str(r.titleZh);
    const prompt = (en && str(r.promptEn)) || str(r.promptZh);
    return [{ title, label: (en && str(r.descEn)) || str(r.descZh), prompt: r.action === "prefill" && prompt ? prompt : `${title}：` }];
  }).slice(0, 12);
}

/** Same GET as api/homeSuggestions.ts; kept local so the island does not split that module out of Home's chunk. */
export async function fetchHomeSuggestions(): Promise<unknown> {
  const response = await getPlatformRuntime().http.get<{ data?: unknown }>("/api/v1/addons/conversation/home-suggestions", { timeout: 2000 });
  return response.data?.data ?? null;
}
