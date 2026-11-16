import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { moveFocus } from "./composerState";
import { CheckMark, ControlsMark } from "./icons";
import { EFFORT_LEVELS, type EffortChoice, type effortView } from "./requestEffort";
import type { Translate } from "./ChatApp";

export function ModelControls({ t, value, view, onChange, children, disabled, defaultOpen = false }: {
  t: Translate; value: EffortChoice; view: ReturnType<typeof effortView>; onChange(value: EffortChoice): void;
  children?: ReactNode; disabled?: boolean; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const items = () => [...(root.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]:not(:disabled)") ?? [])];
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    (items().find((item) => item.getAttribute("aria-checked") === "true") ?? items()[0])?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, view.disabled]);
  const label = (suffix: string) => t(`chatReact.effort${suffix[0]!.toUpperCase()}${suffix.slice(1)}`);
  return <div className="mc-model mc-controls" ref={root} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={(event) => {
    if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (open && event.key === "Tab") { close(); return; }
    if (event.target === trigger.current && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault(); setOpen(true); return;
    }
    if (!open || (event.target as HTMLElement).getAttribute("role") !== "menuitemradio") return;
    const options = items();
    const next = moveFocus(options.length, options.indexOf(document.activeElement as HTMLButtonElement), event.key);
    if (next !== null) { event.preventDefault(); options[next]?.focus(); }
  }}>
    <button ref={trigger} type="button" className="mc-icon-btn" aria-label={t("chatReact.modelControls")}
      title={t("chatReact.modelControls")} aria-haspopup="menu" aria-expanded={open} aria-controls={id}
      disabled={disabled} onClick={() => open ? close() : setOpen(true)}><ControlsMark /></button>
    <div id={id} className="mc-menu" role="menu" aria-label={t("chatReact.modelControls")} hidden={!open}>
      <div className="mc-menu-label">{t("chatReact.effort")}</div>
      <p className="mc-menu-label" id={`${id}-note`}>{label(view.note)}</p>
      {(["", ...EFFORT_LEVELS] as const).map((level) => {
        const off = disabled || view.disabled || (level !== "" && view.off.includes(level));
        return <button key={level} type="button" role="menuitemradio" tabIndex={-1} className="mc-menu-item"
          aria-checked={value === level} aria-describedby={`${id}-note`} disabled={off}
          title={off ? label(view.disabled ? view.note : "off") : undefined} onClick={() => onChange(level)}>
          <span className="mc-menu-text">{label(level || "default")}</span>{value === level && <CheckMark size={14} />}
        </button>;
      })}
      {children}
    </div>
  </div>;
}
