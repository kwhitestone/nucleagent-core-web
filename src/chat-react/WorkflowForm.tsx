import { useEffect, useRef, useState } from "react";
import { getPlatformRuntime, SESSION_CHANGE_EVENT } from "../contracts/platform-runtime";
import { listToolCatalogPages, type ToolCatalogItem } from "../addons/conversation/api/toolCatalog";
import type { ToolInvocation } from "../addons/conversation/api/types";
import { workflowFields, workflowInvocation, workflowToolEligible, validateWorkflowTool, type WorkflowSchema, type WorkflowValue } from "./workflowParams";
import type { Translate } from "./ChatApp";

export const toolSchema = (id: number) => getPlatformRuntime().http.get<{ data: WorkflowSchema & { model?: string } }>(`/api/v1/addons/tool/${id}/schema`).then((response) => response.data.data);
export const EnumSelect = ({ t, options, ...rest }: { t: Translate; options: string[] } & React.SelectHTMLAttributes<HTMLSelectElement>) =>
  <select {...rest}><option value="">{t("chatReact.workflowChoose")}</option>{options.map((value) => <option key={value}>{value}</option>)}</select>;

export function WorkflowForm({ t, submit, disabled }: { t: Translate; submit: (request: ToolInvocation, name: string) => Promise<void>; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [tools, setTools] = useState<ToolCatalogItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [schema, setSchema] = useState<WorkflowSchema>();
  const [values, setValues] = useState<Record<string, WorkflowValue>>({});
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
    if (open) void listToolCatalogPages().then((rows) => { if (live) setTools(rows.filter(workflowToolEligible)); }).catch(() => { if (live) setError("workflowUnavailable"); });
    return () => { live = false; };
  }, [open]);
  useEffect(() => {
    let live = true;
    setSchema(undefined); setValues({});
    if (selected && open) void toolSchema(selected).then((found) => {
      const tool = tools.find((row) => row.id === selected);
      if (!tool) throw new Error("Invalid workflow");
      validateWorkflowTool(tool, found);
      if (live) { setSchema(found); setError(""); }
    }).catch(() => { if (live) setError("workflowUnavailable"); });
    return () => { live = false; };
  }, [selected, open, tools]);
  const missingImage = !!schema?.inputSchema.required?.includes("image_url");
  const run = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitted.current || !schema || disabled || missingImage) return;
    let request: ToolInvocation;
    try {
      const tool = tools.find((row) => row.id === selected);
      if (!tool) throw new Error("Invalid workflow");
      validateWorkflowTool(tool, schema);
      request = workflowInvocation(selected, schema, values);
    } catch { setError("workflowUnavailable"); return; }
    submitted.current = true; setBusy(true); setError("");
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
      {schema?.model && <p className="mc-hint">{t("chatReact.workflowExecutionModel")}: {schema.model}
        {schema.declaredModel && schema.declaredModel !== schema.model && <> · {t("chatReact.workflowDeclaredModel")}: {schema.declaredModel}</>}
      </p>}
      {schema && workflowFields(schema, true).map(([name, field]) => {
        const options = field.enum ?? (field.type === "boolean" ? [true, false] : undefined);
        const control = {
          required: schema.inputSchema.required?.includes(name), disabled: busy,
          value: values[name] === undefined ? "" : String(values[name]),
          onChange: (event: { target: { value: string } }) => {
            if (name === "image_url") return;
            const raw = event.target.value;
            setValues((previous) => {
              const next = { ...previous };
              if (raw === "") delete next[name];
              else next[name] = field.type === "boolean" ? (raw === "true" ? true : raw === "false" ? false : raw)
                : field.type === "integer" ? (/^-?\d+(?:\.0+)?$/.test(raw) ? Number(raw) : raw)
                : field.type === "number" ? Number(raw) : raw;
              return next;
            });
          },
        };
        return <label key={name}>
          {field.description || name}{control.required ? " *" : ""}
          {options && name !== "image_url" ? <select {...control}>
            <option value="">{t("chatReact.workflowChoose")}</option>
            {options.map((value) => <option key={String(value)} value={String(value)}>{String(value)}</option>)}
          </select> : <input {...control} readOnly={name === "image_url"}
            type={field.type === "integer" || field.type === "number" ? "number" : "text"}
            step={field.type === "integer" ? 1 : "any"} min={field.minimum} max={field.maximum} />}
        </label>;
      })}
      {(error || missingImage) && <p role="alert" className="mc-hint">{t(`chatReact.${error || "workflowUnavailable"}`)}</p>}
      <button className="mc-pill" type="submit" disabled={!schema || busy || disabled || missingImage}>{t("chatReact.workflowRun")}</button>
    </form>
  </details>;
}
