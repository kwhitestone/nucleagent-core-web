import { useEffect, useRef, useState } from "react";
import { getPlatformRuntime, SESSION_CHANGE_EVENT } from "@/contracts/platform-runtime";
import type { Translate } from "./ChatApp";

// `reason` from Core is Chinese prose; the view shows the dictionary's "not captured" instead.
// exp106: optional record fields (MUYU-342 web-field-contract, not served yet) render when present; anything else is ignored.
interface Page { available: boolean; content: string; nextOffset: number; revision: string; truncated?: boolean; retainedLength?: unknown; originalLength?: unknown; error?: Record<string, unknown> }
type Fields = Partial<Record<"input" | "output", Page>>;
type O = Record<string, any>;
// exp118: field=record (Core v0.1.83, MUYU-342 fix58b contract). Each block is checked on its own; anything off shape reads "no data".
const obj = (v: unknown): v is O => !!v && typeof v == "object" && !Array.isArray(v);
const join = (...v: unknown[]) => v.filter(x => x != null && x !== "" && typeof x != "object").join(" · ");
function blocks(r: O, t: Translate): [string, string, unknown][] {
 const none = t("chatReact.recNone"), { source: so, transport: tr, business: bu, error: er, duration: du, settlement: st } = r;
 return [
  ["source", "recSource", obj(so) && (so.identityState == "UNKNOWN" ? join(t("chatReact.recUnknown"), so.reason) : so.identityState == "CAPTURED" && join(so.kind, so.toolId && "#" + so.toolId, so.revision && "rev " + so.revision, so.sourceSystem, so.sourceId, so.definitionPath))],
  ["transport", "recTransport", obj(tr) && typeof tr.outcome == "string" && join(tr.outcome == "not_attempted" ? t("chatReact.recRejected") : join(tr.lifecycleStatus, tr.outcome), ...(Array.isArray(tr.hops) ? tr.hops.filter(obj).map(h => `${h.hop}/${h.phase} ${h.httpStatus ?? none}`) : []))],
  ["business", "recBusiness", obj(bu) && typeof bu.outcome == "string" && join(bu.outcome, bu.evidence)],
  ["error", "ioErr", obj(er) && join(er.class, er.origin, er.code, er.message, `${t("chatReact.recHttp")} ${er.upstreamHttpStatus ?? none}`)],
  ["duration", "recDuration", obj(du) && Number.isInteger(du.ms) && du.ms + " ms"],
  ["settlement", "recTurn", obj(st) && (st.state == "settled" ? typeof st.credits == "string" && join(st.amountCny ? "¥" + st.amountCny : `${st.credits} credits / ${st.creditsPerCny ?? none}`, st.points && st.points + " " + t("chatReact.points")) : st.state == "pending" ? t("chatReact.usagePending") : st.state == "unknown" && join(t("chatReact.recUnknownState"), st.reason))],
 ];
}

export default function ToolIO({ messageId, t, failed }: { messageId: number; t: Translate; failed?: boolean }) {
 const [rec, setRec] = useState<O>();
 const name = (field: string) => t(field === "input" ? "chatReact.ioInput" : "chatReact.ioOutput");
 const [open, setOpen] = useState(false);
 const [fields, setFields] = useState<Fields>({});
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState(false);
 const generation = useRef(0);
 useEffect(() => {
  const clear = () => { generation.current++; setOpen(false); setFields({}); setRec(undefined); setBusy(false); };
  window.addEventListener(SESSION_CHANGE_EVENT, clear);
  return () => { generation.current++; window.removeEventListener(SESSION_CHANGE_EVENT, clear); };
 }, [messageId]);
 async function load(names: ("input" | "output")[], append = false) {
  const current = ++generation.current;
  const runtime = getPlatformRuntime();
  const session = runtime.getSessionVersion();
  setBusy(true); setError(false);
  try {
   // record: read once on expand, never paged (no offset/revision). 401/403 fail the whole view; any other miss is "no record" (legacy card).
   const record = append ? undefined : runtime.http.get<{data: Page & {record?: unknown}}>(`/api/v1/addons/conversation/tool-io/${messageId}`, { params: { field: "record" } }).then(
    (response) => { const r = (response as { data?: { data?: { available?: unknown; record?: O } } } | undefined)?.data?.data; return r?.available === true && obj(r.record) && r.record.schemaVersion === 1 ? r.record : undefined; },
    (e) => { if ([401, 403].includes(e?.status)) throw e; });
   const values = await Promise.all(names.map(async (field) => {
    const prior = append ? fields[field] : undefined;
    const response = await runtime.http.get<{data: Page}>(`/api/v1/addons/conversation/tool-io/${messageId}`, {
     params: { field, offset: prior?.nextOffset ?? 0, revision: prior?.revision },
    });
    const page = (response as { data?: { data?: Page } } | undefined)?.data?.data;
    // A body off the page shape is "no details", not a read failure.
    return [field, typeof page?.content == "string" ? { ...page, content: (prior?.content ?? "") + page.content } : undefined] as const;
   }));
   const r = await record;
   if (generation.current === current && runtime.getSessionVersion() === session) { setFields(previous => ({ ...previous, ...Object.fromEntries(values) })); if (!append) setRec(r || undefined); }
  } catch {
   if (generation.current === current) { setFields({}); setRec(undefined); setError(true); }
  } finally { if (generation.current === current) setBusy(false); }
 }
 function toggle() {
  if (open) { generation.current++; setFields({}); setRec(undefined); setBusy(false); }
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
   {rec && <section data-io="record"><h4>{t("chatReact.recTitle")}</h4>
    {rec.recordKind == "legacy" && <p>{t("chatReact.ioMissing")}</p>}
    <dl>{blocks(rec, t).map(([key, label, text]) => <div key={key} data-rec={key}><dt>{t("chatReact." + label)}</dt><dd>{String(text || t("chatReact.recNone"))}</dd></div>)}</dl>
   </section>}
   {busy && <p role="status">{t("common.loading")}</p>}
  </div>}
 </div>;
}
