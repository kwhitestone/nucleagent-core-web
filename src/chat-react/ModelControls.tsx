import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { moveFocus } from "./composerState";
import { CheckMark, ControlsMark } from "./icons";
import { cap, EFFORT_LEVELS, type EffortChoice, type effortView } from "./requestEffort";
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

export function ModelControls({ t, value, view, onChange, children, disabled, defaultOpen = false }: {
  t: Translate; value: EffortChoice; view: ReturnType<typeof effortView>; onChange(value: EffortChoice): void;
  children?: ReactNode; disabled?: boolean; defaultOpen?: boolean;
}) {
  const { open, setOpen, root, trigger, close, rove } = useMenu(defaultOpen, view.disabled);
  const id = useId();
  const label = (suffix: string) => t(`chatReact.effort${cap(suffix)}`);
  return <div className="mc-model mc-controls" ref={root} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={(event) => {
    if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (open && event.key === "Tab") { close(); return; }
    if (event.target === trigger.current && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault(); setOpen(true); return;
    }
    if (!open || (event.target as HTMLElement).getAttribute("role") !== "menuitemradio") return;
    if (rove(event.key)) event.preventDefault();
  }}>
    <button ref={trigger} type="button" className="mc-icon-btn" aria-label={t("chatReact.modelControls")}
      title={t("chatReact.modelControls")} aria-haspopup="menu" aria-expanded={open} aria-controls={id}
      disabled={disabled} onClick={() => open ? close() : setOpen(true)}><ControlsMark />{value && <span data-testid="mc-effort-value">{label(value)}</span>}</button>
    <div id={id} className="mc-menu" role="menu" aria-label={t("chatReact.modelControls")} hidden={!open}>
      <div className="mc-menu-label">{t("chatReact.effort")}</div>
      {view.disabled && <p className="mc-menu-label">{t("chatReact.optionUnavailable")}</p>}
      {(["", ...EFFORT_LEVELS] as const).map((level) => {
        const off = disabled || view.disabled || (level !== "" && view.off.includes(level));
        return <button key={level} type="button" role="menuitemradio" tabIndex={-1} className="mc-menu-item"
          aria-checked={value === level} disabled={off}
          title={off ? t("chatReact.optionUnavailable") : undefined} onClick={() => onChange(level)}>
          <span className="mc-menu-text">{label(level || "default")}</span>{value === level && <CheckMark size={14} />}
        </button>;
      })}
      {children}
    </div>
  </div>;
}
