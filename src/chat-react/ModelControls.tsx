import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { moveFocus } from "./composerState";
import { CheckMark, ControlsMark } from "./icons";
import { cap, EFFORT_LEVELS, type EffortChoice, type effortView } from "./requestEffort";
import type { Translate } from "./ChatApp";
import type { SelectionChoice, SelectionView } from "./modelSelection";

/**
 * Popover plumbing shared by the model menu and Controls: opening focuses the checked radio (again when
 * `refocus` changes), a press outside closes, `close` hands focus back to the trigger, `rove` moves the
 * roving focus for arrows/Home/End and reports whether the key was a move.
 */
export function useMenu(defaultOpen = false, refocus?: unknown) {
  const [open, setOpen] = useState(defaultOpen);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = () => [...(root.current?.querySelectorAll<HTMLButtonElement>("[role^=menuitem]:not(:disabled):not([aria-disabled=true])") ?? [])];
  useEffect(() => {
    if (!open) return;
    (items().find((item) => item.getAttribute("aria-checked") === "true") ?? items()[0])?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, refocus]);
  return {
    open, setOpen, root, trigger,
    close: () => { setOpen(false); trigger.current?.focus(); },
    rove: (key: string) => {
      const list = items();
      const next = moveFocus(list.length, list.indexOf(document.activeElement as HTMLButtonElement), key);
      list[next ?? -1]?.focus();
      return next !== null;
    },
  };
}

/**
 * MUYU-365 exp104 (design D1A): one Controls menu, a root list 「思考强度 · 值 ›」「预设 · 值 ›」, each opening its own page
 * with 「‹ 返回」. `profile` is absent when the model has no presets (D6A). Narrow screens show it as a bottom drawer.
 */
export function ModelControls({ t, value, view, onChange, children, disabled, defaultOpen = false, profile, selection }: {
  t: Translate; value: EffortChoice; view: ReturnType<typeof effortView> & { profileOff?: readonly string[] }; onChange(value: EffortChoice): void;
  children?: ReactNode; disabled?: boolean; defaultOpen?: boolean | "effort"; profile?: { summary: string; name?: string; page: ReactNode };
  /** exp113 stage 2: shown only when Core marks a protocol selectable for this backend; it then replaces 思考强度. */
  selection?: { view: SelectionView; choice: SelectionChoice | null; onChange(choice: SelectionChoice | null): void };
}) {
  const [page, setPage] = useState<"root" | "effort" | "profile" | "protocol" | "level">(defaultOpen === "effort" ? defaultOpen : "root");
  const { open, setOpen, root, trigger, close, rove } = useMenu(!!defaultOpen, `${view.disabled}${page}`);
  useEffect(() => { if (!open) setPage("root"); }, [open]);
  const swipe = useRef(0);
  const id = useId();
  const label = (suffix: string) => t(`chatReact.effort${cap(suffix)}`);
  const open2 = selection?.view.state === "visible" ? selection.view : null;
  const pick = selection?.choice;
  const chosen = open2?.protocols.find((p) => p.name === pick?.protocol);
  const fallback = t("chatReact.selectionDefault");
  // One radio page: 「默认」 then each item; a disabled one shows Core's reason under it and cannot be chosen.
  const radios = (items: { value: string; label: string; on: boolean; reason?: string }[], current: string, set: (value: string) => void) =>
    [{ value: "", label: fallback, on: true }, ...items].map((item) => <div key={item.value}>
      <button type="button" role="menuitemradio" tabIndex={-1} className="mc-menu-item" data-value={item.value} aria-checked={current === item.value}
        disabled={disabled || !item.on} onClick={() => set(item.value)}><span className="mc-menu-text">{item.label}</span>{current === item.value && <CheckMark size={14} />}</button>
      {item.reason && <p className="mc-menu-label">{item.reason}</p>}
    </div>);
  const row = (name: "effort" | "profile" | "protocol" | "level", current: string) => <button type="button" role="menuitem" tabIndex={-1} className="mc-menu-item" data-testid={`mc-ctl-${name}`} onClick={() => setPage(name)}>
    <span className="mc-menu-text">{t(`chatReact.${name}`)}</span><span className="mc-menu-hint">{current}</span><span aria-hidden="true">›</span>
  </button>;
  const back = <button type="button" role="menuitem" tabIndex={-1} className="mc-menu-item" data-testid="mc-ctl-back" onClick={() => setPage("root")}><span aria-hidden="true">‹</span><span className="mc-menu-text">{t("common.back")}</span></button>;
  return <div className="mc-model mc-controls" ref={root} onBlur={(event) => {
    // A row replaced by its page loses focus to nothing (relatedTarget null); only focus moving elsewhere closes.
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={(event) => {
    if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (open && event.key === "Tab") { close(); return; }
    if (event.target === trigger.current && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault(); setOpen(true); return;
    }
    if (!open || !(event.target as HTMLElement).getAttribute("role")?.startsWith("menuitem")) return;
    if (rove(event.key)) event.preventDefault();
  }}>
    <button ref={trigger} type="button" className="mc-icon-btn" aria-label={t("chatReact.modelControls")}
      title={t("chatReact.modelControls")} aria-haspopup="menu" aria-expanded={open} aria-controls={id}
      disabled={disabled} onClick={() => open ? close() : setOpen(true)}><ControlsMark />{value && <span data-testid="mc-effort-value">{label(value)}</span>}{profile?.name && <span data-testid="mc-profile-value">{profile.name}</span>}</button>
    {open && <div className="mc-scrim" onClick={close} />}
    <div id={id} className="mc-menu" role="menu" aria-label={t("chatReact.modelControls")} hidden={!open}
      onTouchStart={(event) => { swipe.current = event.touches[0]!.clientY; }}
      onTouchEnd={(event) => { if (event.changedTouches[0]!.clientY - swipe.current > 60) close(); }}>
      <div className="mc-grab" aria-hidden="true" />
      {page === "root" && <>{open2 ? <>{row("protocol", pick?.protocol || fallback)}{row("level", pick?.level ? label(pick.level) : fallback)}</> : row("effort", label(value || "default"))}{profile && row("profile", profile.summary)}{children}</>}
      {page === "protocol" && open2 && <div data-testid="mc-protocol-page">{back}<div className="mc-menu-label">{t("chatReact.protocol")}</div>
        {radios(open2.protocols.map((p) => ({ value: p.name, label: p.name, on: p.selectable, reason: p.reason })), pick?.protocol ?? "",
          (name) => selection!.onChange(name ? { protocol: name, level: null } : null))}</div>}
      {page === "level" && open2 && <div data-testid="mc-level-page">{back}<div className="mc-menu-label">{t("chatReact.level")}</div>
        {!chosen && <p className="mc-menu-label">{t("chatReact.selectionPickProtocol")}</p>}
        {radios((chosen?.levels ?? []).map((l) => ({ value: l.level, label: label(l.level), on: l.selectable, reason: l.reason })), pick?.level ?? "",
          (level) => chosen && selection!.onChange({ protocol: chosen.name, level: (level || null) as SelectionChoice["level"] }))}</div>}
      {page === "effort" && <div data-testid="mc-effort-page">{back}
        <div className="mc-menu-label">{t("chatReact.effort")}</div>
        {view.disabled && <p className="mc-menu-label">{t("chatReact.optionUnavailable")}</p>}
        {(["", ...EFFORT_LEVELS] as const).map((level) => {
          const off = disabled || view.disabled || (level !== "" && view.off.includes(level));
          return <button key={level} type="button" role="menuitemradio" tabIndex={-1} className="mc-menu-item"
            aria-checked={value === level} disabled={off}
            title={off ? t("chatReact.optionUnavailable") : undefined} onClick={() => onChange(level)}>
            <span className="mc-menu-text">{label(level || "default")}{view.profileOff?.includes(level) ? `（${t("chatReact.profileEffortOff")}）` : ""}</span>{value === level && <CheckMark size={14} />}
          </button>;
        })}
      </div>}
      {page === "profile" && profile && <div data-testid="mc-profile-page">{back}{profile.page}</div>}
    </div>
  </div>;
}
