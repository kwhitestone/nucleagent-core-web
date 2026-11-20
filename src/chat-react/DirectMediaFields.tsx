import { workflowFields, mediaImageField, type DirectMedia } from "./workflowParams";
import type { Translate } from "./ChatApp";
import { ParameterField } from "./ParameterField";

/**
 * MUYU-365 exp98: only required choices show (prefilled from the schema); optional parameters stay in a closed
 * 高级 fold and are left to the model's defaults. Owned frames come from the composer's "+" images, never a picker.
 */
export function DirectMediaFields({ direct, params = {}, setParam, t, frame }: {
  direct: DirectMedia; params?: Record<string, string>; setParam?(name: string, value: string): void; t: Translate; frame?: boolean;
}) {
  const required = direct.schema.inputSchema.required ?? [];
  const field = ([name, field]: ReturnType<typeof workflowFields>[number]) => mediaImageField(name) && !field["x-owned-image"]
    ? <p key={name}>{field.description || name}{required.includes(name) ? " *" : ""}: {t("chatReact.mediaUnavailable")}</p>
    : <ParameterField key={name} field={field} name={name} t={t} value={params[name] ?? ""} required={required.includes(name)} onChange={event => setParam?.(name, event.target.value)} />;
  const fields = workflowFields(direct.schema, true).filter(([name, field]) => name !== direct.prompt && !field["x-owned-image"]);
  const shown = fields.filter(([name]) => required.includes(name)), advanced = fields.filter(([name]) => !required.includes(name));
  const frames = frame && required.some(name => direct.schema.inputSchema.properties[name]?.["x-owned-image"]);
  return <>
    {frames && <p className="mc-media-note">{t("chatReact.mediaFrameHint")}</p>}
    {shown.length > 0 && <div className="mc-media-fields">{shown.map(field)}</div>}
    {advanced.length > 0 && <details className="mc-media-advanced"><summary>{t("chatReact.mediaAdvanced")}</summary><div className="mc-media-fields">{advanced.map(field)}</div></details>}
  </>;
}
