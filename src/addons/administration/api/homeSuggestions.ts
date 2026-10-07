/** Home suggestion cards (admin) — Core addons/admin/router/home_suggestions.go. */
import { getPlatformRuntime } from "@/contracts/platform-runtime";
import { normalizeItem, type HomeSuggestionItem } from "@/composables/homeSuggestions";
import type { Envelope } from "./admin";

const http = () => getPlatformRuntime().http;
const BASE = "/api/v1/addons/admin/home-suggestions";

export interface HomeSuggestionsConfig {
  items: HomeSuggestionItem[];
  revision: number;
  updatedAt: string | null;
  source: "stored" | "builtin";
}

function unwrap(body: Envelope<HomeSuggestionsConfig> | undefined): HomeSuggestionsConfig {
  const data = body?.data;
  if (!data || !Array.isArray(data.items)) throw new Error("malformed home suggestions response");
  return { ...data, items: data.items.map(normalizeItem).filter((i): i is HomeSuggestionItem => !!i) };
}

export async function getHomeSuggestions(): Promise<HomeSuggestionsConfig> {
  return unwrap((await http().get<Envelope<HomeSuggestionsConfig>>(BASE)).data);
}

/** Replaces every card; sortOrder is the list order. 409 = someone saved since `expectedRevision`. */
export async function saveHomeSuggestions(items: HomeSuggestionItem[], expectedRevision: number): Promise<HomeSuggestionsConfig> {
  const body = { expectedRevision, items: items.map((item, i) => ({ ...item, sortOrder: (i + 1) * 10 })) };
  return unwrap((await http().put<Envelope<HomeSuggestionsConfig>>(BASE, body)).data);
}

export async function resetHomeSuggestions(): Promise<HomeSuggestionsConfig> {
  return unwrap((await http().post<Envelope<HomeSuggestionsConfig>>(`${BASE}/reset`)).data);
}
