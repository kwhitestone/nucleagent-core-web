import { useEffect, useRef, useState } from "react";
import { getPlatformRuntime, SESSION_CHANGE_EVENT } from "../contracts/platform-runtime";
import { listToolCatalog, type ToolCatalogItem } from "../addons/conversation/api/toolCatalog";
import type { ToolInvocation } from "../addons/conversation/api/types";
import { workflowFields, workflowInvocation, type WorkflowSchema } from "./workflowParams";
import type { Translate } from "./ChatApp";

export const toolSchema = (id: number) => getPlatformRuntime().http.get<{ data: WorkflowSchema & { model?: string } }>(`/api/v1/addons/tool/${id}/schema`).then((response) => response.data.data);
export const EnumSelect = ({ t, options, ...rest }: { t: Translate; options: string[] } & React.SelectHTMLAttributes<HTMLSelectElement>) =>
  <select {...rest}><option value="">{t("chatReact.workflowChoose")}</option>{options.map((value) => <option key={value}>{value}</option>)}</select>;

export function WorkflowForm({ t, submit, disabled }: { t: Translate; submit: (request: ToolInvocation, name: string) => Promise<void>; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [tools, setTools] = useState<ToolCatalogItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [schema, setSchema] = useState<WorkflowSchema>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitted = useRef(false);
  useEffect(() => {
    const reset = () => { setOpen(false); setSelected(0); setSchema(undefined); setValues({}); setTools([]); };
    window.addEventListener(SESSION_CHANGE_EVENT, reset);
    return () => window.removeEventListener(SESSION_CHANGE_EVENT, reset);
  }, []);
  useEffect(() => {
    let live = true;
    if (open) void listToolCatalog().then((rows) => { if (live) setTools(rows.filter((row) => row.imported && row.status === "ready")); }).catch(() => { if (live) setError("workflowUnavailable"); });
    return () => { live = false; };
  }, [open]);
  useEffect(() => {
    let live = true;
    setSchema(undefined); setValues({});
    if (selected && open) void toolSchema(selected).then((found) => {
      workflowFields(found);
      if (live) { setSchema(found); setError(""); }
    }).catch(() => { if (live) setError("workflowUnavailable"); });
    return () => { live = false; };
  }, [selected, open]);
  const run = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitted.current || !schema || disabled) return;
    let request: ToolInvocation;
    try { request = workflowInvocation(selected, schema, values); } catch { setError("workflowUnavailable"); return; }
    submitted.current = true; setBusy(true);
    try { await submit(request, tools.find((tool) => tool.id === selected)?.name ?? ""); }
    catch { setError("workflowUnknown"); }
  };
  return <details className="mc-workflow" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="mc-pill">{t("chatReact.workflow")}</summary>
    <form onSubmit={run}>
      <p className="mc-hint">{t("chatReact.workflowHint")}</p>
      <select aria-label={t("chatReact.workflow")} value={selected} disabled={busy} onChange={(event) => setSelected(Number(event.target.value))}>
        <option value={0}>{t("chatReact.workflowChoose")}</option>
        {tools.map((tool) => <option key={tool.id} value={tool.id}>{tool.name}</option>)}
      </select>
      {schema && workflowFields(schema).map(([name, field]) => {
        const control = { required: schema.inputSchema.required?.includes(name), disabled: busy, value: values[name] ?? "", onChange: (event: { target: { value: string } }) => setValues({ ...values, [name]: event.target.value }) };
        return <label key={name}>
          {field.description || name}
          {field.enum ? <EnumSelect t={t} options={field.enum} {...control} /> : <input {...control} />}
        </label>;
      })}
      {error && <p role="alert" className="mc-hint">{t(`chatReact.${error}`)}</p>}
      <button className="mc-pill" type="submit" disabled={!schema || busy || disabled}>{t("chatReact.workflowRun")}</button>
    </form>
  </details>;
}
