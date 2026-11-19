import { useEffect, useRef, useState } from "react";
import { getPlatformRuntime, SESSION_CHANGE_EVENT } from "../contracts/platform-runtime";
import { listToolCatalogPages, type ToolCatalogItem } from "../addons/conversation/api/toolCatalog";
import type { ToolInvocation } from "../addons/conversation/api/types";
import { workflowFields, workflowFormInvocation, workflowToolEligible, validateWorkflowTool, mediaImageField, type WorkflowSchema } from "./workflowParams";
import type { Translate } from "./ChatApp";
import { AudioFilePicker } from "./AudioFilePicker";
import { ParameterField } from "./ParameterField";

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
  const generation = useRef(0);
  const renderGeneration = generation.current;
  useEffect(() => {
    const reset = () => { generation.current++; submitted.current = false; setBusy(false); setError(""); setOpen(false); setSelected(0); setSchema(undefined); setValues({}); setTools([]); };
    window.addEventListener(SESSION_CHANGE_EVENT, reset);
    return () => window.removeEventListener(SESSION_CHANGE_EVENT, reset);
  }, []);
  useEffect(() => {
    let live = true;
    const current = generation.current;
    if (open) void listToolCatalogPages().then((rows) => { if (live && current === generation.current) setTools(rows.filter(workflowToolEligible)); }).catch(() => { if (live && current === generation.current) setError("workflowUnavailable"); });
    return () => { live = false; };
  }, [open]);
  useEffect(() => {
    let live = true;
    const current = generation.current;
    setSchema(undefined); setValues({});
    if (selected && open) void toolSchema(selected).then((found) => {
      const tool = tools.find((row) => row.id === selected);
      if (!tool) throw new Error("Invalid workflow");
      validateWorkflowTool(tool, found);
      if (live && current === generation.current) { setSchema(found); setError(""); }
    }).catch(() => { if (live && current === generation.current) setError("workflowUnavailable"); });
    return () => { live = false; };
  }, [selected, open, tools]);
  const missingImage = !!schema?.inputSchema.required?.some(name => mediaImageField(name) && (!schema.inputSchema.properties[name]?.["x-owned-image"] || !values[name]));
  const run = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitted.current || !schema || disabled || missingImage || renderGeneration !== generation.current) return;
    let request: ToolInvocation;
    try {
      const tool = tools.find((row) => row.id === selected);
      if (!tool) throw new Error("Invalid workflow");
      validateWorkflowTool(tool, schema);
      request = workflowFormInvocation(selected, schema, values);
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
        if (field["x-owned-image"]) return <AudioFilePicker key={`${selected}:${schema.invocation?.revision}:${name}`} image label={name} value={values[name] ?? ""} disabled={busy || !!disabled} onChange={value => setValues(previous => ({ ...previous, [name]: value }))} />;
        if (name === "fileId" && schema.nativeCapability === "nucleagent.audio.stt.v1") return <AudioFilePicker key={`${selected}:${schema.invocation?.revision}`} value={String(values.fileId ?? "")} disabled={busy || !!disabled} onChange={(fileId) => setValues(fileId ? { fileId } : {})} />;
        const control = {
          required: schema.inputSchema.required?.includes(name), disabled: busy,
          value: values[name] === undefined ? "" : String(values[name]),
          onChange: (event: { target: { value: string } }) => {
            if (mediaImageField(name)) return;
            setValues((previous) => ({ ...previous, [name]: event.target.value }));
          },
        };
        return <ParameterField key={name} field={field} name={name} t={t} {...control} readOnly={mediaImageField(name)} />;
      })}
      {(error || missingImage) && <p role="alert" className="mc-hint">{t(`chatReact.${error || "workflowUnavailable"}`)}</p>}
      <button className="mc-pill" type="submit" disabled={!schema || busy || disabled || missingImage}>{t("chatReact.workflowRun")}</button>
    </form>
  </details>;
}
