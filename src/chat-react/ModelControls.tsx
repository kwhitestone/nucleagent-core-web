import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { moveFocus } from "./composerState";
import { ControlsMark } from "./icons";
import type { Translate } from "./ChatApp";

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
 * design-1123 A (P1 A): the 「思考」 pill opens the preset radios directly — no root list, no protocol/level/effort pages,
 * no 返回. The pill shows the preset name (「预设」 by default) and ⚠ when the preset no longer fits the model.
 * Absent when the model has no presets (D6A). Narrow screens show it as a bottom drawer.
 */
export function ModelControls({ t, children, disabled, defaultOpen = false, profile }: {
  t: Translate; children?: ReactNode; disabled?: boolean; defaultOpen?: boolean;
  profile: { name?: string; stale?: boolean; page: ReactNode };
}) {
  const { open, setOpen, root, trigger, close, rove } = useMenu(defaultOpen);
  const swipe = useRef(0);
  const id = useId();
  const label = [t("chatReact.profile"), profile.name, profile.stale && "⚠"].filter(Boolean).join(" · ");
  return <div className="mc-model mc-controls" ref={root} onBlur={(event) => {
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
    <button ref={trigger} type="button" className="mc-icon-btn" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={id}
      data-stale={profile.stale || undefined} disabled={disabled} onClick={() => open ? close() : setOpen(true)}>
      <ControlsMark /><span data-testid="mc-profile-value">{profile.name || t("chatReact.profile")}</span>{profile.stale && <span data-testid="mc-profile-stale" aria-hidden="true">⚠</span>}
    </button>
    {open && <div className="mc-scrim" onClick={close} />}
    <div id={id} className="mc-menu" role="menu" aria-label={t("chatReact.profile")} hidden={!open}
      onTouchStart={(event) => { swipe.current = event.touches[0]!.clientY; }}
      onTouchEnd={(event) => { if (event.changedTouches[0]!.clientY - swipe.current > 60) close(); }}>
      <div className="mc-grab" aria-hidden="true" />
      <div data-testid="mc-profile-page">{profile.page}</div>{children}
    </div>
  </div>;
}
