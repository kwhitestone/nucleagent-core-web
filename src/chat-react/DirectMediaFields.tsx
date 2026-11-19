import { workflowFields, mediaImageField, type DirectMedia } from "./workflowParams";
import type { Translate } from "./ChatApp";
import { ParameterField } from "./ParameterField";
import { AudioFilePicker } from "./AudioFilePicker";

export function DirectMediaFields({ direct, params = {}, setParam, t }: {
  direct: DirectMedia; params?: Record<string, string>; setParam?(name: string, value: string): void; t: Translate;
}) {
  return workflowFields(direct.schema, true).filter(([name]) => name !== direct.prompt).map(([name, field]) => {
    const required = direct.schema.inputSchema.required?.includes(name);
    if (field["x-owned-image"]) return <AudioFilePicker key={`${direct.toolId}:${direct.schema.invocation?.revision}:${name}`} image label={name} disabled={!setParam} value={params[name] ?? ""} onChange={value => setParam?.(name, value)} />;
    if (mediaImageField(name)) return <p key={name}>{field.description || name}{required ? " *" : ""}: {t("chatReact.mediaUnavailable")}</p>;
    return <ParameterField key={name} field={field} name={name} t={t} value={params[name] ?? ""} required={required} onChange={event => setParam?.(name, event.target.value)} />;
  });
}
