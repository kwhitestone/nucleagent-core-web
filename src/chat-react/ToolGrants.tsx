import { catalogText } from "./catalogText";
import { SESSION_CHANGE_EVENT } from "../contracts/platform-runtime";
import { useEffect, useRef, useState } from "react";
import { readToolPage, type CatalogCursor, toolLabel, toolUnavailable, coveredBySkills, effectiveToolIds, TOOL_CATALOG_PATH, type ToolCatalogItem } from "../addons/conversation/api/toolCatalog";
import { SKILL_PATH } from "../addons/conversation/api/skill";
import type { Skill } from "../addons/conversation/api/types";
import { getSessionBindings, updateSessionBindings, type SessionBindings } from "../addons/conversation/api/sessionBindings";
import { toast } from "@/composables/useToast";
import { CheckMark, CrossMark } from "./icons";
import { fill } from "./singleSlotQueue";
import type { Translate } from "./ChatApp";


type Row = { id: number; name: string; i18n?: Record<string, unknown> };
type SkillRow = Row & Pick<Skill, "config"> & {
  toolCount?: number; hiddenTools?: number; linkedTools?: { id: number; name: string; ready: boolean }[];
};
function useCatalogPages<T extends Row>(path: string, conversationId: string | undefined, search: string) {
  const [rows, setRows] = useState<T[]>();
  const [total, setTotal] = useState<number>();
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
      setTotal(page.total);
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
      setTotal(undefined);
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
  return { rows, total, failed, more: !!cursor.current, load };
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
  return { ...shown, catalogTotal: all.total, loaded: !!shown.rows, search, setSearch, known: [...known.values()], remember, setPicks };
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
const hidden = (tool: ToolCatalogItem) => [tool.reason, tool.status].some(state => state === "held" || state === "manual_disabled");

export function useToolGrants(conversationId: string | undefined, t: Translate, locale: string) {
  const tools = usePagedList<ToolCatalogItem>(TOOL_CATALOG_PATH, conversationId);
  const skills = usePagedList<SkillRow>(SKILL_PATH, conversationId);
  const [bound, setBound] = useState<Partial<SessionBindings> & { busy?: boolean }>({ skillIds: [], toolIds: [] });
  const generation = useRef(0);
  // How many bound ids the catalog no longer offers (switched off, paused, deleted); Core refuses them on save.
  const stale = useRef(0);
  // Results land only while the conversation/account they were asked for is still current.
  const later = <T,>(run: (value: T) => void) => { const current = generation.current; return (value: T) => current === generation.current && run(value); };
  useEffect(() => {
    const reset = () => { generation.current++; stale.current = 0; skills.setPicks([]); tools.setPicks([]); setBound({ skillIds: [], toolIds: [] }); };
    reset();
    if (conversationId) getSessionBindings(conversationId).then(later((saved: SessionBindings) => {
      setBound(saved);
      // Bound picks are named on their chips before (or without) the list being opened; ids it no longer offers are stale.
      for (const key of ["skillIds", "toolIds"] as const) if (saved[key].length) void readToolPage({ page: 1 }, "", key < "t" ? SKILL_PATH : TOOL_CATALOG_PATH, saved[key]).then(later((page: { items: ToolCatalogItem[]; next: unknown }) => {
        if (key < "t") skills.setPicks(page.items);
        // Every save then sends only what is offered. shortcut: past one page (32) of bound ids none is dropped; read on if that is refused.
        const kept = saved[key].filter(id => page.next || page.items.some(row => row.id === id && !toolUnavailable(row)));
        stale.current += saved[key].length - kept.length;
        setBound(now => ({ ...now, [key]: kept }));
      }), () => {});
    }), () => {});
    const saved = (event: Event) => setBound((event as CustomEvent<SessionBindings>).detail);
    window.addEventListener(SESSION_CHANGE_EVENT, reset);
    window.addEventListener(BINDINGS_EVENT, saved);
    return () => { generation.current++; window.removeEventListener(SESSION_CHANGE_EVENT, reset); window.removeEventListener(BINDINGS_EVENT, saved); };
  }, [conversationId]);
  const ids = bound.toolIds!, skillIds = bound.skillIds!, editable = !bound.busy && (!conversationId || !!bound.editable);
  useEffect(() => { if (ids.length) tools.load(); }, [ids.length > 0]);
  const label = (row: Row) => catalogText(toolLabel(row as ToolCatalogItem, locale));
  const save = (next: { skillIds?: number[]; toolIds?: number[] }) => {
    if (!editable) return;
    if (!conversationId) return setBound({ skillIds, toolIds: ids, ...next });
    setBound({ ...bound, busy: true });
    updateSessionBindings(conversationId, { ...next, revision: bound.revision! })
      .then(later((saved: SessionBindings) => {
        setBound(share(saved));
        if (stale.current) toast.info(fill(t("chatReact.staleRemoved"), { n: stale.current })), stale.current = 0;
      }), later((error: { status?: number; message?: string }) => {
        setBound(bound);
        toast.error(t(error?.status === 422 && error.message === "tool_covered_by_skill" ? "agents.mine.errToolCovered" : "common.bindingsSaveFailed"));
      }));
  };
  const picked = skills.known.filter(row => skillIds.includes(row.id)).map(row => ({ ...row, label: label(row) }));
  const coveredNote = (providers: number[]) => {
    const names = picked.filter(skill => providers.includes(skill.id)).map(skill => skill.label);
    const count = fill(t("chatReact.bySkills"), { n: providers.length });
    return [t("common.toolCoveredBySkill"), count, ...names].join(" · ");
  };
  const countLabel = (row: SkillRow) => row.toolCount ? fill(t("chatReact.bringsTools"), { n: row.toolCount }) : t(row.hiddenTools ? "chatReact.toolsPaused" : "chatReact.noTools");
  return {
    countLabel,
    tools: { ...tools, rows: (tools.rows ?? []).filter(row => !hidden(row) && !row.nativeCapability).map(row => {
      const by = row.skillIds?.filter(id => skillIds.includes(id)) ?? [];
      const locked = by.length > 0 && !toolUnavailable(row);
      return { id: row.id, label: label(row), on: locked || ids.includes(row.id), off: locked || toolUnavailable(row),
        unbound: !row.skillIds?.length && !toolUnavailable(row), count: "", note: locked ? coveredNote(by) : toolUnavailable(row) ? t("chatReact.optionUnavailable") : catalogText(row.description ?? "") };
    }) },
    skills: { ...skills, rows: (skills.rows ?? []).map(row => ({ id: row.id, label: label(row), on: skillIds.includes(row.id), off: false,
      unbound: false, count: countLabel(row), note: catalogText(row.config?.description ?? "") })) },
    editable, skillIds, picked, coveredNote,
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
      save(toolIds.length === ids.length ? { skillIds: nextSkills } : { skillIds: nextSkills, toolIds });
    },
  };
}
export type ToolGrants = ReturnType<typeof useToolGrants>;
type List = ToolGrants["tools"] | ToolGrants["skills"];

const atEnd = (el: HTMLElement) => el.scrollTop + el.clientHeight >= el.scrollHeight - 16;
/** The skill or tool list: search, rows with their note, scroll paging, plain-words retry and end. */
export function PagedList({ list, editable, toggle, t, search, toolList }: {
  list: List; editable: boolean; toggle(id: number): void; t: Translate; search: string; toolList: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [unboundOnly, setUnboundOnly] = useState(toolList);
  const rows = unboundOnly ? list.rows.filter(row => row.unbound || row.on) : list.rows;
  // Read on while the rows do not fill the box: neither a scroll nor the eye has anything to reach for.
  useEffect(() => {
    const el = box.current!;
    if (list.loaded && list.more && !list.failed && (!rows.length || el.clientHeight && atEnd(el))) void list.load();
  }, [list.loaded, list.more, list.failed, list.known.length, rows.length]);
  useEffect(() => { if (box.current) box.current.scrollTop = 0; }, [list.search, unboundOnly]);
  return <>
    {toolList && <label className="mc-grant-scope"><input type="checkbox" checked={unboundOnly} onChange={event => setUnboundOnly(event.target.checked)} />{t("chatReact.independent")}</label>}
    <div className="mc-search"><input type="search" aria-label={search} placeholder={search} value={list.search} onChange={event => list.setSearch(event.target.value)} /></div>
    <div className="mc-grants" ref={box} onScroll={event => {
      if (!list.failed && atEnd(event.currentTarget)) void list.load();
    }}>
      {rows.map(row => <button key={row.id} type="button" className="mc-menu-item" aria-pressed={row.on} disabled={!editable || row.off} onClick={() => toggle(row.id)}>
        <span className="mc-grant-check" aria-hidden="true">{row.on && <CheckMark size={12} />}</span>
        <span className="mc-grant-copy"><span className="mc-row-name">{row.label}</span>
          {row.note && <small>{row.note}</small>}{row.count && <span className="mc-grant-count">{row.count}</span>}
        </span>
      </button>)}
    </div>
    <div className="mc-grant-foot" role="status">
      {list.failed || list.more && list.loaded
        ? <button type="button" onClick={list.load}>{t(list.failed ? "chatReact.loadFailed" : "chatReact.loadMore")}</button>
        : !list.loaded ? t("common.loading") : rows.length ? t("chatReact.listEnd") : t(list.search.trim() ? "chatReact.noMatch" : "chatReact.emptyList")}
    </div>
  </>;
}

type Props = { grants: ToolGrants; t: Translate };
const Chip = ({ id, label, remove, action, children }: { id: number; label: string; remove?(id: number): void; action: string; children?: React.ReactNode }) => <span className="mc-chip">
  {children ?? <span className="mc-chip-name" title={label}>{label}</span>}
  {remove && <button type="button" className="mc-chip-remove" aria-label={action}
    onClick={() => { remove(id); document.querySelector("textarea")?.focus(); }}><CrossMark size={12} /></button>}
</span>;

export function ToolGrantChips({ grants, t, skills = true }: Props & { skills?: boolean }) {
  const [expanded, setExpanded] = useState<number>();
  const detail = grants.picked.find(skill => skill.id === expanded);
  useEffect(() => { if (!detail) setExpanded(undefined); }, [detail?.id]);
  return <>
    {skills && grants.picked.length > 0 && <div className="mc-grant-shelf" data-testid="mc-skill-picks">
      <div className="mc-chips mc-skill-chips">
        {grants.picked.map(skill => <Chip key={skill.id} {...skill} action={`${t("chatReact.remove")} ${skill.label}`} remove={grants.editable ? grants.toggleSkill : undefined}>
          <button type="button" className="mc-grant-tag" aria-expanded={skill.id === expanded}
            onClick={() => setExpanded(skill.id === expanded ? undefined : skill.id)}>
            <span>{t("chatReact.picked")}</span><span className="mc-chip-name" title={skill.label}>{skill.label}</span>
            <small>{fill(t("chatReact.tagCount"), { n: skill.toolCount ?? 0 })}</small><span aria-hidden="true">▾</span>
          </button>
        </Chip>)}
      </div>
      {detail && <section role="region" aria-label={detail.label} className="mc-grant-detail">
        <strong>{detail.label} · {grants.countLabel(detail)}</strong>
        {detail.linkedTools?.map(tool => <div key={tool.id}>
          {catalogText(tool.name)} · {tool.ready ? grants.coveredNote(grants.picked.filter(skill => skill.linkedTools?.some(link => link.id === tool.id && link.ready)).map(skill => skill.id)) : t("chatReact.optionUnavailable")}
        </div>)}
        {!!detail.hiddenTools && <div>{fill(t("chatReact.hiddenTools"), { n: detail.hiddenTools })}</div>}
      </section>}
      <small className="mc-grant-status">{fill(t("chatReact.skillsAllowed"), { n: grants.skillIds.length })}</small>
    </div>}
    {grants.enabled.length > 0 && <div className="mc-chips mc-manual-chips" data-testid="mc-tool-grants">
      <span className="mc-grants-label">{t("chatReact.toolGrantsEnabled")}</span>
      {grants.enabled.map(tool => <Chip key={tool.id} {...tool} action={t("common.disable")} remove={grants.editable ? grants.toggle : undefined} />)}
    </div>}
  </>;
}
