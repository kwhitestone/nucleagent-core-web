/**
 * Option search for pickers with hundreds of rows (L7 PICKER-WEB): source
 * groups, case-insensitive search over label/note/keywords, highlight, paging,
 * debounce. Pure so node --test covers it without a DOM.
 * Static option sets use these local helpers. Skill/tool resource lists use
 * remote search and pagination, including the selected-resource view.
 */
import type { Skill } from "../api/types.ts";

export type SkillSource = "system" | "imported" | "mine";
export const SKILL_SOURCES: readonly SkillSource[] = ["system", "imported", "mine"];
/** Rows rendered per "show more" step; keeps 500+ options cheap to render. */
export const PAGE_SIZE = 50;
export const SEARCH_DEBOUNCE_MS = 200;

/** Imported = engine import row; system = config.is_system; the rest was uploaded here. */
export function skillSource(skill: Skill): SkillSource {
  if (skill.sourceSystem) return "imported";
  return skill.config?.is_system === true ? "system" : "mine";
}

export interface Searchable {
  label: string;
  note?: string;
  keywords?: string;
  group?: string;
}

export const haystackOf = (o: Searchable): string =>
  `${o.label}\n${o.note ?? ""}\n${o.keywords ?? ""}`.toLocaleLowerCase();

/** group "" = all groups. */
export function filterOptions<T extends Searchable>(options: T[], query: string, group = ""): T[] {
  const q = query.trim().toLocaleLowerCase();
  return options.filter((o) => (!group || o.group === group) && (!q || haystackOf(o).includes(q)));
}

export function countByGroup(options: Searchable[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const o of options) if (o.group) counts[o.group] = (counts[o.group] ?? 0) + 1;
  return counts;
}

export interface Segment {
  text: string;
  hit: boolean;
}

/** Case-insensitive match split into segments; rendered as text, never v-html. */
export function highlight(value: string, query: string): Segment[] {
  const needle = query.trim().toLocaleLowerCase();
  const lower = value.toLocaleLowerCase();
  // Lower-casing can change length (e.g. "İ"); indices would drift, so do not mark.
  if (!needle || lower.length !== value.length) return [{ text: value, hit: false }];
  const out: Segment[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
    if (at > from) out.push({ text: value.slice(from, at), hit: false });
    out.push({ text: value.slice(at, at + needle.length), hit: true });
    from = at + needle.length;
  }
  if (from < value.length) out.push({ text: value.slice(from), hit: false });
  return out;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): ((...args: A) => void) & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  return Object.assign(run, { cancel: () => clearTimeout(timer) });
}
