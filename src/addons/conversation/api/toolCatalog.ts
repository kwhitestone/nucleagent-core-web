/**
 * Tool catalog (L6 core f0bfbef, G-TASK-TOOL-PICK-1900): `GET /api/v1/addons/tool/catalog`
 * returns the tools a user may pick (toolselect.Selectable) with safe fields only
 * (id/name/description/i18n/skillIds/imported; never mcp_config / URLs). Readable with
 * core:skill:read, so ordinary users get it. Picked ids go to POST /conversation `toolIds`
 * and to my agent's `toolIds`; the server re-checks every id.
 */
import { getPlatformRuntime } from "../../../contracts/platform-runtime.ts";
import type { SheetOption } from "../components/OptionSheet.vue";

export const TOOL_CATALOG_PATH = "/api/v1/addons/tool/catalog";

export interface ToolCatalogItem {
  id: number;
  name: string;
  description?: string;
  i18n?: Record<string, unknown>;
  /** Skills that bring this tool along; selecting one of them already exposes it. */
  skillIds?: number[];
  imported?: boolean;
}

const localized = (tool: ToolCatalogItem, locale: string, key: "name" | "description"): string => {
  const bundle = tool.i18n?.[locale];
  const value = bundle && typeof bundle === "object" ? (bundle as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" ? value : "";
};

export const toolLabel = (tool: ToolCatalogItem, locale: string) => localized(tool, locale, "name") || tool.name;

export const coveredBySkills = (tool: ToolCatalogItem | undefined, skillIds: readonly number[]) =>
  !!tool?.skillIds?.some((id) => skillIds.includes(id));

/** Tools brought by one of `skillIds` are listed disabled with `coveredNote`. */
export function toolOptions(tools: ToolCatalogItem[], locale: string, importedBadge: string, skillIds: readonly number[] = [], coveredNote = ""): SheetOption[] {
  return tools.map((tool) => {
    const covered = coveredBySkills(tool, skillIds);
    return {
      value: String(tool.id),
      label: toolLabel(tool, locale),
      note: covered ? coveredNote : localized(tool, locale, "description") || tool.description || undefined,
      keywords: tool.name,
      group: tool.imported ? "imported" : "system",
      badges: tool.imported ? [importedBadge] : undefined,
      ...(covered ? { disabled: true } : {}),
    };
  });
}

/** Drops picks a selected skill already brings (the server refuses those: tool_covered_by_skill). */
export function effectiveToolIds(toolIds: readonly number[], tools: ToolCatalogItem[], skillIds: readonly number[]): number[] {
  return toolIds.filter((id) => !coveredBySkills(tools.find((t) => t.id === id), skillIds));
}

/** Only well-formed items survive; [] when this core has no catalog (404/405). */
export async function listToolCatalog(): Promise<ToolCatalogItem[]> {
  try {
    const r = await getPlatformRuntime().http.get<{ data?: unknown }>(TOOL_CATALOG_PATH);
    const rows: unknown[] = Array.isArray(r.data?.data) ? r.data.data : [];
    return rows.filter((t): t is ToolCatalogItem => !!t && typeof t === "object"
      && Number.isSafeInteger((t as ToolCatalogItem).id) && (t as ToolCatalogItem).id > 0 && typeof (t as ToolCatalogItem).name === "string")
      .map((t) => ({ ...t, skillIds: Array.isArray(t.skillIds) ? t.skillIds.filter((id) => Number.isSafeInteger(id)) : [] }));
  } catch (e) {
    if ([404, 405].includes((e as { status?: number } | null)?.status as number)) return [];
    throw e;
  }
}
