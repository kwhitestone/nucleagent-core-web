import { useEffect, useRef, useState } from "react";
import { SESSION_CHANGE_EVENT } from "../contracts/platform-runtime";
import { listToolCatalogPages, toolLabel, toolUnavailable, type ToolCatalogItem } from "../addons/conversation/api/toolCatalog";
import { getSessionBindings, updateSessionBindings, type SessionBindings } from "../addons/conversation/api/sessionBindings";
import { toast } from "@/composables/useToast";
import { CrossMark } from "./icons";
import type { Translate } from "./ChatApp";

/**
 * MUYU-365 exp85: enabling a tool authorizes the agent to call it; the model passes every argument.
 * A new chat keeps the set locally and sends it as POST /conversation `toolIds`; an existing one
 * reads and replaces its set through the session bindings contract (owner-only, revisioned, next
 * turn). Core re-checks every id (Selectable) and every call still passes the gateway checks.
 * Media job tools (direct image/video) and native audio (user-chosen material) are not grants.
 */
/** Both writers of this conversation's revisioned bindings (grants, media job tools) share each saved set. */
export const BINDINGS_EVENT = "mc-bindings";
const share = (saved: SessionBindings) => { window.dispatchEvent(new window.CustomEvent(BINDINGS_EVENT, { detail: saved })); return saved; };

export function useToolGrants(conversationId: string | undefined, t: Translate, locale: string) {
  const [rows, setRows] = useState<ToolCatalogItem[]>();
  const [bound, setBound] = useState<Partial<SessionBindings> & { busy?: boolean }>({ toolIds: [] });
  const generation = useRef(0);
  // Results land only while the conversation/account they were asked for is still current.
  const later = <T,>(run: (value: T) => void) => { const current = generation.current; return (value: T) => current === generation.current && run(value); };
  const load = () => { if (!rows) listToolCatalogPages().then(later(setRows), later(() => setRows([]))); };
  useEffect(() => {
    const reset = () => { generation.current++; setBound({ toolIds: [] }); setRows(undefined); };
    reset();
    if (conversationId) getSessionBindings(conversationId).then(later(setBound), () => {});
    const saved = (event: Event) => setBound((event as CustomEvent<SessionBindings>).detail);
    window.addEventListener(SESSION_CHANGE_EVENT, reset);
    window.addEventListener(BINDINGS_EVENT, saved);
    return () => { window.removeEventListener(SESSION_CHANGE_EVENT, reset); window.removeEventListener(BINDINGS_EVENT, saved); };
  }, [conversationId]);
  const ids = bound.toolIds!, editable = !conversationId || !!bound.editable;
  useEffect(() => { if (ids.length) load(); }, [ids.length > 0]);
  const tools = (rows ?? []).filter((row) => !toolUnavailable(row) && !row.mediaModel && !row.nativeCapability).map((row) => ({ ...row, label: toolLabel(row, locale) }));
  return {
    ids, tools, editable, loaded: !!rows, load,
    enabled: tools.filter((tool) => ids.includes(tool.id)),
    toggle: (id: number) => {
      if (!editable || bound.busy) return;
      const toolIds = ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
      if (!conversationId) return setBound({ toolIds });
      setBound({ ...bound, busy: true });
      updateSessionBindings(conversationId, { toolIds, revision: bound.revision! })
        .then(later((saved: SessionBindings) => setBound(share(saved))), later(() => { setBound(bound); toast.error(t("common.bindingsSaveFailed")); }));
    },
  };
}
export type ToolGrants = ReturnType<typeof useToolGrants>;
type Props = { grants: ToolGrants; t: Translate };

export const ToolGrantList = ({ grants, t }: Props) => grants.loaded && <div className="mc-grants">{grants.tools.length ? null : t("chatReact.optionUnavailable")}
  {grants.tools.map((tool) => <button key={tool.id} type="button" className="mc-menu-item" aria-pressed={grants.ids.includes(tool.id)} disabled={!grants.editable} onClick={() => grants.toggle(tool.id)}>{tool.label}</button>)}
</div>;

export const ToolGrantChips = ({ grants, t }: Props) => grants.enabled.length > 0 && <div className="mc-chips" data-testid="mc-tool-grants">
  <span className="mc-grants-label">{t("chatReact.toolGrantsEnabled")}</span>
  {grants.enabled.map((tool) => <span key={tool.id} className="mc-chip">
    <span className="mc-chip-name">{tool.label}</span>
    {grants.editable && <button type="button" className="mc-chip-remove" aria-label={t("common.disable")}
      onClick={() => { grants.toggle(tool.id); document.querySelector("textarea")!.focus(); }}><CrossMark size={12} /></button>}
  </span>)}
</div>;
