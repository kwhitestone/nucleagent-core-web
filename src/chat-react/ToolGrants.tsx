import { SESSION_CHANGE_EVENT } from "../contracts/platform-runtime";
import { useEffect, useRef, useState } from "react";
import { readToolPage, type CatalogCursor, toolLabel, toolUnavailable, coveredBySkills, effectiveToolIds, TOOL_CATALOG_PATH, type ToolCatalogItem } from "../addons/conversation/api/toolCatalog";
import { SKILL_PATH } from "../addons/conversation/api/skill";
import type { Skill } from "../addons/conversation/api/types";
import { getSessionBindings, updateSessionBindings, type SessionBindings } from "../addons/conversation/api/sessionBindings";
import { toast } from "@/composables/useToast";
import { CrossMark } from "./icons";
import type { Translate } from "./ChatApp";

type Row = { id: number; name: string; i18n?: Record<string, unknown> };
type SkillRow = Row & Pick<Skill, "config"> & {
  toolCount?: number; hiddenTools?: number; linkedTools?: { id: number; name: string; ready: boolean }[];
};
function useCatalogPages<T extends Row>(path: string, conversationId: string | undefined, search: string) {
  const [rows, setRows] = useState<T[]>();
  const generation = useRef(0);
  const cursor = useRef<CatalogCursor | null>({ page: 1 });
  const loading = useRef(false);
  const [failed, setFailed] = useState(false);
  const load = async () => {
    const next = cursor.current;
    if (!next || loading.current) return;
    const current = generation.current;
    loading.current = true;
    setFailed(false);
    try {
      let page = await readToolPage(next, search, path);
      if (generation.current !== current) return;
      const restart = page.changed;
      if (restart) page = await readToolPage({ page: 1 }, search, path);
      if (generation.current !== current) return;
      cursor.current = page.next;
      setRows(previous => [...(restart ? [] : previous ?? []), ...page.items as unknown as T[]]);
    } catch {
      if (generation.current === current) setFailed(true);
    } finally {
      if (generation.current === current) loading.current = false;
    }
  };
  useEffect(() => {
    const reset = () => {
      generation.current++;
      cursor.current = { page: 1 };
      loading.current = false;
      setRows(undefined);
      setFailed(false);
    };
    reset();
    const timer = search && window.setTimeout(load, 180);
    window.addEventListener(SESSION_CHANGE_EVENT, reset);
    return () => {
      if (timer) window.clearTimeout(timer);
      generation.current++;
      window.removeEventListener(SESSION_CHANGE_EVENT, reset);
    };
  }, [conversationId, search]);
  return { rows, failed, more: !!cursor.current, load };
}

/** One searchable, scroll-paged list (skills or tools): the shown page set plus every row read so far. */
function usePagedList<T extends Row>(path: string, conversationId: string | undefined) {
  const [search, setSearch] = useState("");
  const [picks, setPicks] = useState<T[]>([]);
  const all = useCatalogPages<T>(path, conversationId, "");
  const matches = useCatalogPages<T>(path, conversationId, search.trim());
  const shown = search.trim() ? matches : all;
  useEffect(() => setSearch(""), [conversationId]);
  const known = new Map([...picks, ...all.rows ?? [], ...matches.rows ?? []].map(row => [row.id, row]));
  const remember = (id: number) => {
    const row = known.get(id);
    if (row) setPicks(previous => [...previous.filter(pick => pick.id !== id), row]);
    return row;
  };
  return { ...shown, loaded: !!shown.rows, search, setSearch, known: [...known.values()], remember, setPicks };
}

/**
 * MUYU-365 exp85: enabling a tool authorizes the agent to call it; the model passes every argument.
 * V6: picking a skill lets the model use it and the tools it brings this turn (skillIds). A ready tool a picked
 * skill brings shows locked (never stored as a pick) until every picking skill is removed; a hand pick it covers
 * is kept but not sent (effectiveToolIds, as the agent wizard) so removing the skill brings it back.
 * A new chat keeps both sets locally and sends them with POST /conversation; an existing one reads and
 * replaces them through the session bindings contract (owner-only, revisioned, next turn).
 */
/** Both writers of this conversation's revisioned bindings (grants, media job tools) share each saved set. */
export const BINDINGS_EVENT = "mc-bindings";
const share = (saved: SessionBindings) => { window.dispatchEvent(new window.CustomEvent(BINDINGS_EVENT, { detail: saved })); return saved; };
// Confirmed unavailable: not shown at all. Any other non-ready state stays listed, not pickable.
const hidden = (tool: ToolCatalogItem) => ["held", "manual_disabled"].some(state => state === tool.reason || state === tool.status);

export function useToolGrants(conversationId: string | undefined, t: Translate, locale: string) {
  const tools = usePagedList<ToolCatalogItem>(TOOL_CATALOG_PATH, conversationId);
  const skills = usePagedList<SkillRow>(SKILL_PATH, conversationId);
  const [bound, setBound] = useState<Partial<SessionBindings> & { busy?: boolean }>({ skillIds: [], toolIds: [] });
  const generation = useRef(0);
  // Results land only while the conversation/account they were asked for is still current.
  const later = <T,>(run: (value: T) => void) => { const current = generation.current; return (value: T) => current === generation.current && run(value); };
  useEffect(() => {
    const reset = () => { generation.current++; skills.setPicks([]); tools.setPicks([]); setBound({ skillIds: [], toolIds: [] }); };
    reset();
    if (conversationId) getSessionBindings(conversationId).then(later((saved: SessionBindings) => {
      setBound(saved);
      // Bound skills are named on their chips before (or without) the skill list being opened.
      if (saved.skillIds.length) void readToolPage({ page: 1 }, "", SKILL_PATH, saved.skillIds).then(later((page: { items: Row[] }) => skills.setPicks(page.items)), () => {});
    }), () => {});
    const saved = (event: Event) => setBound((event as CustomEvent<SessionBindings>).detail);
    window.addEventListener(SESSION_CHANGE_EVENT, reset);
    window.addEventListener(BINDINGS_EVENT, saved);
    return () => { generation.current++; window.removeEventListener(SESSION_CHANGE_EVENT, reset); window.removeEventListener(BINDINGS_EVENT, saved); };
  }, [conversationId]);
  const ids = bound.toolIds!, skillIds = bound.skillIds!, editable = !conversationId || !!bound.editable;
  useEffect(() => { if (ids.length) tools.load(); }, [ids.length > 0]);
  const label = (row: Row) => toolLabel(row as ToolCatalogItem, locale);
  const save = (next: { skillIds?: number[]; toolIds: number[] }) => {
    if (!editable || bound.busy) return;
    if (!conversationId) return setBound({ skillIds, ...next });
    setBound({ ...bound, busy: true });
    updateSessionBindings(conversationId, { ...next, revision: bound.revision! })
      .then(later((saved: SessionBindings) => setBound(share(saved))), later((error: { status?: number; message?: string }) => {
        setBound(bound);
        toast.error(t(error?.status === 422 && error.message === "tool_covered_by_skill" ? "agents.mine.errToolCovered" : "common.bindingsSaveFailed"));
      }));
  };
  const pickedSkills = skills.known.filter(row => skillIds.includes(row.id));
  const countLabel = (row: SkillRow) => row.toolCount ? t("chatReact.bringsTools").replace("{n}", String(row.toolCount)) : t("chatReact.noTools");
  return {
    countLabel,
    tools: { ...tools, rows: (tools.rows ?? []).filter(row => !hidden(row) && !row.nativeCapability).map(row => {
      const by = row.skillIds?.filter(id => skillIds.includes(id)).length ?? 0;
      const locked = !!by && !toolUnavailable(row);
      return { id: row.id, label: label(row), on: locked || ids.includes(row.id), off: locked || toolUnavailable(row),
        note: locked ? `${t("common.toolCoveredBySkill")} · ${t("chatReact.bySkills").replace("{n}", String(by))}` : toolUnavailable(row) ? t("chatReact.optionUnavailable") : undefined };
    }) },
    skills: { ...skills, rows: (skills.rows ?? []).map(row => ({ id: row.id, label: label(row), on: skillIds.includes(row.id), off: false,
      note: [row.config?.description, countLabel(row)].filter(Boolean).join(" · ") })) },
    editable, skillIds, picked: pickedSkills.map(row => ({ ...row, label: label(row) })),
    /** Hand-picked tools still sent (a picked skill does not already bring them). */
    ids: effectiveToolIds(ids, tools.known, skillIds),
    enabled: tools.known.filter(tool => ids.includes(tool.id) && !hidden(tool) && !coveredBySkills(tool, skillIds)).map(tool => ({ id: tool.id, label: label(tool) })),
    toggle: (id: number) => {
      tools.remember(id);
      save({ toolIds: ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id] });
    },
    toggleSkill: (id: number) => {
      const seen = skills.remember(id);
      const nextSkills = skillIds.includes(id) ? skillIds.filter(value => value !== id) : [...skillIds, id];
      const toolIds = conversationId ? effectiveToolIds(ids, tools.known, nextSkills).filter(tool => !seen?.linkedTools?.some(link => nextSkills.includes(id) && link.id === tool)) : ids;
      save({ toolIds, skillIds: nextSkills });
    },
  };
}
export type ToolGrants = ReturnType<typeof useToolGrants>;
type List = ToolGrants["tools"] | ToolGrants["skills"];

/** The skill or tool list: search, rows with their note, scroll paging, plain-words retry and end. */
export const PagedList = ({ list, editable, toggle, t, search }: { list: List; editable: boolean; toggle(id: number): void; t: Translate; search: string }) => <>
  <div className="mc-search"><input type="search" aria-label={search} placeholder={search} value={list.search} onChange={event => list.setSearch(event.target.value)} /></div>
  <div className="mc-grants" onScroll={event => {
    const box = event.currentTarget;
    if (list.more && box.scrollTop + box.clientHeight >= box.scrollHeight - 16) void list.load();
  }}>
    {list.rows.map(row => <button key={row.id} type="button" className="mc-menu-item" aria-pressed={row.on} disabled={!editable || row.off} onClick={() => toggle(row.id)}>
      <span className="mc-row-name">{row.label}</span>{row.note && <span className="mc-menu-sub">{row.note}</span>}
    </button>)}
    {list.loaded && !list.more && <p className="mc-hint">{list.rows.length ? t("chatReact.listEnd") : t(list.search.trim() ? "chatReact.noMatch" : "chatReact.optionUnavailable")}</p>}
    {(list.failed || list.more && list.loaded) && <button type="button" onClick={list.load}>{t(list.failed ? "chatReact.loadFailed" : "chatReact.loadMore")}</button>}
  </div></>;

type Props = { grants: ToolGrants; t: Translate };
const Chip = ({ id, label, remove, action, children }: { id: number; label: string; remove?(id: number): void; action: string; children?: React.ReactNode }) => <span className="mc-chip">
  {children ?? <span className="mc-chip-name" title={label}>{label}</span>}
  {remove && <button type="button" className="mc-chip-remove" aria-label={action}
    onClick={() => { remove(id); document.querySelector("textarea")?.focus(); }}><CrossMark size={12} /></button>}
</span>;

/** Picked skills (outlined: allowed, the model may not use them) and hand-picked tools, inside the composer. */
export const ToolGrantChips = ({ grants, t, skills = true }: Props & { skills?: boolean }) => <>
  {skills && grants.picked.length > 0 && <div className="mc-chips mc-skill-chips" data-testid="mc-skill-picks">
    <span className="mc-grants-label">{t("chatReact.skillsAllowed")}</span>
    {grants.picked.map(skill => <Chip key={skill.id} {...skill} action={`${t("chatReact.remove")} ${skill.label}`} remove={grants.editable ? grants.toggleSkill : undefined}>
      <details><summary><span className="mc-chip-name" title={skill.label}>{skill.label}</span> · {grants.countLabel(skill)}</summary>
        {skill.linkedTools?.map(tool => <div key={tool.id}>{tool.name} · {t(tool.ready ? "common.toolCoveredBySkill" : "chatReact.optionUnavailable")}</div>)}
        {!!skill.hiddenTools && <div>{t("chatReact.hiddenTools").replace("{n}", String(skill.hiddenTools))}</div>}
      </details></Chip>)}
  </div>}
  {grants.enabled.length > 0 && <div className="mc-chips" data-testid="mc-tool-grants">
    <span className="mc-grants-label">{t("chatReact.toolGrantsEnabled")}</span>
    {grants.enabled.map(tool => <Chip key={tool.id} {...tool} action={t("common.disable")} remove={grants.editable ? grants.toggle : undefined} />)}
  </div>}
</>;
