/**
 * PLACEHOLDER (L7 ToolPicker) — contract draft for L6 TOOL-SELECT-CORE, taken
 * from DESIGN §B2: `GET /api/v1/addons/tool/catalog` returns enabled, visible
 * tools with safe fields only (never mcp_config / URLs). The endpoint does not
 * exist yet: nothing calls it, ToolPicker.vue is not mounted, and no tool UI
 * ships until L6 lands and this type is checked against the real response.
 */
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

export function toolOptions(tools: ToolCatalogItem[], locale: string, importedBadge: string): SheetOption[] {
  return tools.map((tool) => ({
    value: String(tool.id),
    label: localized(tool, locale, "name") || tool.name,
    note: localized(tool, locale, "description") || tool.description || undefined,
    keywords: tool.name,
    group: tool.imported ? "imported" : "system",
    badges: tool.imported ? [importedBadge] : undefined,
  }));
}
