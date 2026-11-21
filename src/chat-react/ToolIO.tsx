import { useEffect, useRef, useState } from "react";
import { getPlatformRuntime, SESSION_CHANGE_EVENT } from "@/contracts/platform-runtime";
import type { Translate } from "./ChatApp";

// `reason` from Core is Chinese prose; the view shows the dictionary's "not captured" instead.
// exp106: optional record fields (MUYU-342 web-field-contract, not served yet) render when present; anything else is ignored.
interface Page { available: boolean; content: string; nextOffset: number; revision: string; truncated?: boolean; retainedLength?: unknown; originalLength?: unknown; error?: Record<string, unknown> }
type Fields = Partial<Record<"input" | "output", Page>>;

export default function ToolIO({ messageId, t, failed }: { messageId: number; t: Translate; failed?: boolean }) {
 const name = (field: string) => t(field === "input" ? "chatReact.ioInput" : "chatReact.ioOutput");
 const [open, setOpen] = useState(false);
 const [fields, setFields] = useState<Fields>({});
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState(false);
 const generation = useRef(0);
 useEffect(() => {
  const clear = () => { generation.current++; setOpen(false); setFields({}); setBusy(false); };
  window.addEventListener(SESSION_CHANGE_EVENT, clear);
  return () => { generation.current++; window.removeEventListener(SESSION_CHANGE_EVENT, clear); };
 }, [messageId]);
 async function load(names: ("input" | "output")[], append = false) {
  const current = ++generation.current;
  const runtime = getPlatformRuntime();
  const session = runtime.getSessionVersion();
  setBusy(true); setError(false);
  try {
   const values = await Promise.all(names.map(async (field) => {
    const prior = append ? fields[field] : undefined;
    const response = await runtime.http.get<{data: Page}>(`/api/v1/addons/conversation/tool-io/${messageId}`, {
     params: { field, offset: prior?.nextOffset ?? 0, revision: prior?.revision },
    });
    const page = (response as { data?: { data?: Page } } | undefined)?.data?.data;
    // A body off the page shape is "no details", not a read failure.
    return [field, typeof page?.content == "string" ? { ...page, content: (prior?.content ?? "") + page.content } : undefined] as const;
   }));
   if (generation.current === current && runtime.getSessionVersion() === session) setFields(previous => ({ ...previous, ...Object.fromEntries(values) }));
  } catch {
   if (generation.current === current) { setFields({}); setError(true); }
  } finally { if (generation.current === current) setBusy(false); }
 }
 function toggle() {
  if (open) { generation.current++; setFields({}); setBusy(false); }
  else void load(["input", "output"]);
  setOpen(!open);
 }
 return <div className="mc-tool-io">
  <button type="button" aria-expanded={open} onClick={toggle}>{t("chatReact.ioToggle")} {open ? "⌃" : "⌄"}</button>
  {open && <div>
   {error && <p role="alert">{t("chatReact.ioError")}</p>}
   {!error && !busy && !fields.input?.available && !fields.output?.available && <p>{t("chatReact.ioNone")}</p>}
   {(["input", "output"] as const).map(field => {
    const page = fields[field];
    if (!page) return null;
    let object: Record<string, unknown> | undefined;
    let rendered = page.content;
    if (page.nextOffset === -1) {
     try {
      const value = JSON.parse(page.content);
      if (field === "input" && value && typeof value === "object" && !Array.isArray(value)) object = value;
      rendered = typeof value === "string" ? value : JSON.stringify(value, null, 2);
     } catch {}
    }
    const bad = field == "output" && (failed || !!page.error);
    const e: Record<string, unknown> = page.error || {};
    return <section key={field} data-io={bad ? "error" : field}><h4>{bad ? t("chatReact.ioErr") : name(field)}</h4>
     {bad && <p>{[e.class, e.code, e.message].filter(v => v != null && typeof v != "object").join(" · ")}</p>}
     {page.truncated && <p>{t("chatReact.ioCut")} {[page.retainedLength, page.originalLength].filter(Number.isInteger).join(" / ")}</p>}
     {!page.available ? <p>{t("chatReact.ioMissing")}</p> : object ? <dl>{Object.entries(object).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd></div>)}</dl> : <pre>{rendered === "" ? t("chatReact.ioEmpty") : rendered}</pre>}
     {page.nextOffset >= 0 && <button type="button" disabled={busy} onClick={() => void load([field], true)}>{t("chatReact.ioMore")}{name(field)}</button>}
    </section>;
   })}
   {busy && <p role="status">{t("common.loading")}</p>}
  </div>}
 </div>;
}
